#Requires -Modules ActiveDirectory
param(
    [string]$QueuePath          = 'C:\scripts\pending',
    [string]$OrganizationalUnit = 'OU=Administrativos,DC=prueba,DC=local',
    [string]$ErrorSubfolder     = 'error',
    [string]$DefaultCompany     = ''
)

Import-Module ActiveDirectory
$ErrorActionPreference = 'Stop'

function Write-QueueLog {
    param([string]$Message, [string]$Level = 'INFO')
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Write-Host "[$ts] [$Level] $Message"
}

function New-AdSafePassword {
    return ConvertTo-SecureString "Aris1234*" -AsPlainText -Force
}

function Escape-AdFilterValue {
    param([string]$Value)
    if ($null -eq $Value) { return '' }
    return $Value.Replace('\', '\5c').Replace('*', '\2a').Replace('(', '\28').Replace(')', '\29').Replace("'", "''")
}

# ── Validar carpetas base ─────────────────────────────────────────────────────
$errDir = Join-Path $QueuePath $ErrorSubfolder

if (-not (Test-Path -LiteralPath $QueuePath)) {
    Write-QueueLog "No existe la carpeta de cola: $QueuePath" "ERROR"
    exit 1
}

if (-not (Test-Path -LiteralPath $errDir)) {
    try {
        New-Item -ItemType Directory -Path $errDir -Force | Out-Null
        Write-QueueLog "Carpeta de errores creada: $errDir"
    } catch {
        Write-QueueLog "No se pudo crear carpeta de errores: $($_.Exception.Message)" "ERROR"
        exit 1
    }
}

# ── Procesar archivos ─────────────────────────────────────────────────────────
$files = @(Get-ChildItem -LiteralPath $QueuePath -Filter 'pendiente-*.json' -File -ErrorAction SilentlyContinue)

if ($files.Count -eq 0) {
    Write-QueueLog "No hay archivos pendientes en $QueuePath"
    exit 0
}

foreach ($f in $files) {
    Write-QueueLog "Procesando: $($f.Name)"

    try {
        $item = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8 | ConvertFrom-Json

        if (-not $item.samAccountName)    { throw "Falta campo 'samAccountName'" }
        if (-not $item.userPrincipalName) { throw "Falta campo 'userPrincipalName'" }
        if (-not $item.primerNombre)      { throw "Falta campo 'primerNombre'" }
        if (-not $item.primerApellido)    { throw "Falta campo 'primerApellido'" }
        if (-not $item.employeeId -or [string]::IsNullOrWhiteSpace($item.employeeId.ToString())) {
            throw "Falta campo 'employeeId' (cédula / ID)"
        }

        $sam = $item.samAccountName.Trim().ToLower()
        $samEsc = Escape-AdFilterValue $sam

        $exists = Get-ADUser -Filter "SamAccountName -eq '$samEsc'" -ErrorAction SilentlyContinue
        if ($exists) { throw "Usuario ya existe en AD: $sam" }

        $empId = $item.employeeId.ToString().Trim()
        $empIdEsc = Escape-AdFilterValue $empId
        $idDup = Get-ADUser -Filter "EmployeeID -eq '$empIdEsc'" -ErrorAction SilentlyContinue
        if ($idDup) {
            throw "Ya existe un usuario en AD con la misma cédula / EmployeeID: $empId"
        }

        $ou = $OrganizationalUnit
        if ($item.queueMetadata -and $item.queueMetadata.ouDn) {
            $ou = [string]$item.queueMetadata.ouDn
        }

        try {
            Get-ADOrganizationalUnit -Identity $ou -ErrorAction Stop | Out-Null
        } catch {
            throw "La OU no existe o no es accesible: '$ou'"
        }

        $givenParts = @($item.primerNombre.Trim())
        if ($item.segundoNombre -and $item.segundoNombre.ToString().Trim()) {
            $givenParts += $item.segundoNombre.ToString().Trim()
        }
        $givenName = $givenParts -join ' '

        $snParts = @($item.primerApellido.Trim())
        if ($item.segundoApellido -and $item.segundoApellido.ToString().Trim()) {
            $snParts += $item.segundoApellido.ToString().Trim()
        }
        $surname = $snParts -join ' '

        if ($item.displayName -and $item.displayName.ToString().Trim()) {
            $displayName = $item.displayName.ToString().Trim()
        } else {
            $displayName = "$givenName $surname"
        }

        $upn = $item.userPrincipalName.Trim().ToLower()
        if ($upn -notmatch "@") { throw "UPN inválido: '$upn'" }

        if ($item.email -and $item.email.ToString().Trim()) {
            $mail = $item.email.ToString().Trim().ToLower()
        } else {
            $mail = $upn
        }

        $company = $null
        if ($item.empresa -and $item.empresa.ToString().Trim()) {
            $company = $item.empresa.ToString().Trim()
        } elseif ($item.company -and $item.company.ToString().Trim()) {
            $company = $item.company.ToString().Trim()
        } elseif ($item.queueMetadata -and $item.queueMetadata.company -and $item.queueMetadata.company.ToString().Trim()) {
            $company = $item.queueMetadata.company.ToString().Trim()
        } elseif ($DefaultCompany -and $DefaultCompany.Trim()) {
            $company = $DefaultCompany.Trim()
        }

        $password = New-AdSafePassword
        Write-QueueLog "Creando usuario '$sam' en OU: $ou (correo: $mail)"

        $newParams = @{
            Name                   = $displayName
            SamAccountName         = $sam
            UserPrincipalName      = $upn
            GivenName              = $givenName
            Surname                = $surname
            DisplayName            = $displayName
            Path                   = $ou
            AccountPassword        = $password
            Enabled                = $true
            ChangePasswordAtLogon  = $true
            EmailAddress           = $mail
        }
        if ($company) {
            $newParams['Company'] = $company
        }

        New-ADUser @newParams

        if ($item.cargo)        { Set-ADUser -Identity $sam -Title       ([string]$item.cargo) }
        if ($item.departamento) { Set-ADUser -Identity $sam -Department  ([string]$item.departamento) }
        if ($item.employeeId)   { Set-ADUser -Identity $sam -EmployeeID   ([string]$item.employeeId) }
        if ($item.city)         { Set-ADUser -Identity $sam -City         ([string]$item.city) }

        Remove-Item -LiteralPath $f.FullName -Force
        Write-QueueLog "Usuario creado OK: $sam"

    } catch {
        $errorMsg = $_.Exception.Message
        Write-QueueLog "FALLO procesando '$($f.Name)': $errorMsg" "ERROR"

        try {
            if (-not (Test-Path -LiteralPath $errDir)) {
                New-Item -ItemType Directory -Path $errDir -Force | Out-Null
            }
            $dest = Join-Path $errDir $f.Name
            if (Test-Path -LiteralPath $f.FullName) {
                Move-Item -LiteralPath $f.FullName -Destination $dest -Force
                Write-QueueLog "Archivo movido a error: $dest"
            } else {
                Write-QueueLog "El archivo ya no existe en cola, no se puede mover: $($f.FullName)" "WARN"
            }
        } catch {
            Write-QueueLog "No se pudo mover '$($f.Name)' a error: $($_.Exception.Message)" "ERROR"
        }
    }
}

Write-QueueLog "Procesamiento finalizado."
