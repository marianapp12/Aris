#requires -Version 5.1
param(
  [Parameter(Mandatory = $true)]
  [string]$PayloadPath
)

$ErrorActionPreference = 'Stop'

function Write-JobResult {
  param($Object)
  $json = $Object | ConvertTo-Json -Depth 4 -Compress
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

try {
  if (-not (Test-Path -LiteralPath $PayloadPath)) {
    throw "No existe PayloadPath: $PayloadPath"
  }
  $p = Get-Content -Raw -Encoding UTF8 -Path $PayloadPath | ConvertFrom-Json
  $computerName = [string]$p.computerName
  $upnSuffix = [string]$p.upnSuffix
  $candidates = @($p.candidates | ForEach-Object { [string]$_ })

  if ([string]::IsNullOrWhiteSpace($computerName)) { throw 'computerName requerido' }
  if ($candidates.Count -eq 0) { throw 'candidates requerido' }

  $remCred = Get-WinRmCredentialOptional

  foreach ($sam in $candidates) {
    if ([string]::IsNullOrWhiteSpace($sam)) { continue }
    $icParams = @{
      ComputerName = $computerName
      ScriptBlock  = {
        param($Sam)
        try {
          $null = Get-ADUser -Identity $Sam -ErrorAction Stop
          return $true
        } catch {
          return $false
        }
      }
      ArgumentList = $sam
    }
    if ($null -ne $remCred) {
      $icParams['Credential'] = $remCred
    }
    $exists = Invoke-Command @icParams

    if (-not $exists) {
      $upn = if ($upnSuffix -match '@') { "$sam$upnSuffix" } else { "$sam@$upnSuffix" }
      Write-JobResult @{
        ok                = $true
        sAMAccountName    = $sam
        userPrincipalName = $upn
        error             = $null
      }
      exit 0
    }
  }

  Write-JobResult @{
    ok    = $false
    error = 'No hay nombre SamAccountName disponible entre los candidatos'
  }
  exit 1
}
catch {
  Write-JobResult @{
    ok    = $false
    error = $_.Exception.Message
  }
  exit 1
}
