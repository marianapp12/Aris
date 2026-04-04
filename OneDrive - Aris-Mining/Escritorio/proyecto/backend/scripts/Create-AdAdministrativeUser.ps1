#requires -Version 5.1
<#
.SYNOPSIS
  Crea usuario en AD vía Invoke-Command y opcionalmente conecta a EXO/MSOL (legado).
  Lee parámetros desde JSON (-PayloadPath). Emite una línea AD_JOB_RESULT_JSON: {...} al final.
#>
param(
  [Parameter(Mandatory = $true)]
  [Alias('PayloadFile')]
  [string]$PayloadPath
)

$ErrorActionPreference = 'Stop'

function Write-JobResult {
  param($Object)
  $json = $Object | ConvertTo-Json -Depth 6 -Compress
  Write-Output "AD_JOB_RESULT_JSON:$json"
}

function Get-WinRmCredentialOptional {
  $u = $env:AD_PS_WINRM_USER
  $p = $env:AD_PS_WINRM_PASSWORD
  if ([string]::IsNullOrWhiteSpace($u) -or [string]::IsNullOrWhiteSpace($p)) {
    return $null
  }
  return (New-Object System.Management.Automation.PSCredential (
      $u,
      (ConvertTo-SecureString -String $p -AsPlainText -Force)
    ))
}

function New-RandomPasswordPlain {
  $upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  $lower = 'abcdefghijkmnopqrstuvwxyz'
  $num = '23456789'
  $special = '@#$%&*'
  $parts = @(
    -join (1..4 | ForEach-Object { $upper[(Get-Random -Maximum $upper.Length)] })
    -join (1..4 | ForEach-Object { $lower[(Get-Random -Maximum $lower.Length)] })
    -join (1..3 | ForEach-Object { $num[(Get-Random -Maximum $num.Length)] })
    -join (1..2 | ForEach-Object { $special[(Get-Random -Maximum $special.Length)] })
  )
  ($parts | Sort-Object { Get-Random }) -join ''
}

try {
  if (-not (Test-Path -LiteralPath $PayloadPath)) {
    throw "No existe PayloadPath: $PayloadPath"
  }
  $p = Get-Content -Raw -Encoding UTF8 -Path $PayloadPath | ConvertFrom-Json

  $sam = [string]$p.samAccountName
  $upn = [string]$p.userPrincipalName
  $email = [string]$p.email
  $given = [string]$p.givenName
  $sur = [string]$p.surName
  $display = [string]$p.displayName
  $title = [string]$p.title
  $dept = [string]$p.department
  $company = [string]$p.company
  $city = [string]$p.city
  $employeeId = [string]$p.employeeId
  $ouPath = [string]$p.ouPath
  $computerName = [string]$p.computerName
  $homeRoot = [string]$p.homeDirectoryRoot
  $groups = @($p.groups | ForEach-Object { [string]$_ })
  $skipCloud = [bool]$p.skipCloudSteps
  $repadminEnabled = [bool]$p.repadminEnabled
  $repadminLines = @($p.repadminLines | ForEach-Object { [string]$_ })
  $cloudSleepSeconds = [int]$p.cloudSleepSeconds
  if ($cloudSleepSeconds -lt 0) { $cloudSleepSeconds = 0 }
  $mfaBlockEnabled = [bool]$p.mfaBlockEnabled
  $passwordScriptPath = [string]$p.passwordGeneratorScriptPath

  if ([string]::IsNullOrWhiteSpace($sam)) { throw 'samAccountName requerido' }
  if ([string]::IsNullOrWhiteSpace($computerName)) { throw 'computerName requerido' }
  if ([string]::IsNullOrWhiteSpace($ouPath)) { throw 'ouPath requerido' }

  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

  $plainPwd = $null
  if (-not [string]::IsNullOrWhiteSpace($passwordScriptPath) -and (Test-Path -LiteralPath $passwordScriptPath)) {
    . $passwordScriptPath
    if (Get-Command -Name Ramdom-Password -ErrorAction SilentlyContinue) {
      $plainPwd = Ramdom-Password
    } elseif (Get-Command -Name Random-Password -ErrorAction SilentlyContinue) {
      $plainPwd = Random-Password
    }
  }
  if ([string]::IsNullOrWhiteSpace($plainPwd)) {
    $plainPwd = New-RandomPasswordPlain
  }

  $secPwd = ConvertTo-SecureString -String $plainPwd -AsPlainText -Force
  $homeDir = $homeRoot.TrimEnd('\') + '\' + $sam

  if (-not $skipCloud) {
    $exoUser = $env:AD_PS_EXO_USER
    $exoPass = $env:AD_PS_EXO_PASSWORD
    if ([string]::IsNullOrWhiteSpace($exoUser) -or [string]::IsNullOrWhiteSpace($exoPass)) {
      throw 'AD_PS_EXO_USER y AD_PS_EXO_PASSWORD deben estar definidos en el entorno del proceso, o use AD_PS_SKIP_CLOUD_STEPS=true'
    }
    $secCred = New-Object System.Management.Automation.PSCredential ($exoUser, (ConvertTo-SecureString $exoPass -AsPlainText -Force))

    if (Get-Module -ListAvailable -Name ExchangeOnlineManagement) {
      Import-Module ExchangeOnlineManagement -ErrorAction Stop
      Connect-ExchangeOnline -Credential $secCred -ShowBanner:$false
    }
    if (Get-Module -ListAvailable -Name MSOnline) {
      Import-Module MSOnline -ErrorAction Stop
      Connect-MsolService -Credential $secCred
    }
  }

  $remCredAd = Get-WinRmCredentialOptional
  $icAdParams = @{
    ComputerName = $computerName
    ArgumentList = @(
      $ouPath, $sam, $email, $given, $sur, $display, $title, $homeDir,
      $company, $dept, $city, $secPwd, $true, $employeeId, $groups
    )
    ScriptBlock  = {
    param(
      $OULocal, $CuentaLocal, $emailLocal, $NameLocal, $LastNameLocal, $DisplayLocal,
      $TitleLocal, $PathLocal, $CompanyLocal, $DepartmentLocal, $CityLocal,
      $PwsdLocal, $TrueLocal, $CedulaLocal, $GroupsRemote
    )

    New-ADUser `
      -SamAccountName $CuentaLocal `
      -UserPrincipalName $emailLocal `
      -EmailAddress $emailLocal `
      -Name $DisplayLocal `
      -DisplayName $DisplayLocal `
      -HomeDrive 'Z:' `
      -HomeDirectory $PathLocal `
      -GivenName $NameLocal `
      -SurName $LastNameLocal `
      -Title $TitleLocal `
      -Company $CompanyLocal `
      -Department $DepartmentLocal `
      -City $CityLocal `
      -State '' `
      -AccountPassword $PwsdLocal `
      -EmployeeID $CedulaLocal `
      -Enabled $TrueLocal `
      -Path $OULocal

    foreach ($g in $GroupsRemote) {
      if (-not [string]::IsNullOrWhiteSpace($g)) {
        Add-ADGroupMember -Identity $g -Members $CuentaLocal -ErrorAction Stop
      }
    }
  }
  }
  if ($null -ne $remCredAd) {
    $icAdParams['Credential'] = $remCredAd
  }
  Invoke-Command @icAdParams

  if ($repadminEnabled -and $repadminLines.Count -gt 0) {
    foreach ($line in $repadminLines) {
      if (-not [string]::IsNullOrWhiteSpace($line)) {
        Invoke-Expression $line
      }
    }
  }

  if (-not $skipCloud -and $cloudSleepSeconds -gt 0) {
    Start-Sleep -Seconds $cloudSleepSeconds
  }

  if (-not $skipCloud -and (Get-Command Get-MsolUser -ErrorAction SilentlyContinue)) {
    $synced = $false
    $attempts = 0
    while (-not $synced -and $attempts -lt 40) {
      $u = Get-MsolUser -UserPrincipalName $upn -ErrorAction SilentlyContinue
      if ($null -ne $u) {
        $synced = $true
        break
      }
      Start-Sleep -Seconds 60
      $attempts++
    }
  }

  if ($mfaBlockEnabled -and -not $skipCloud -and (Get-Command Set-MsolUser -ErrorAction SilentlyContinue)) {
    $sa = New-Object -TypeName Microsoft.Online.Administration.StrongAuthenticationRequirement
    $sa.RelyingParty = '*'
    $sa.State = 'Enabled'
    $sar = @($sa)
    Set-MsolUser -UserPrincipalName $upn -StrongAuthenticationRequirements $sar -ErrorAction SilentlyContinue
  }

  if (-not $skipCloud -and (Get-Command Disconnect-ExchangeOnline -ErrorAction SilentlyContinue)) {
    Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue
  }

  Write-JobResult @{
    ok                = $true
    error             = $null
    sAMAccountName    = $sam
    userPrincipalName = $upn
    displayName       = $display
    email             = $email
  }
  exit 0
}
catch {
  Write-JobResult @{
    ok    = $false
    error = $_.Exception.Message
  }
  exit 1
}
