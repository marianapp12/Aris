#Requires -Modules ActiveDirectory
# NOTA EDITOR: Si VS Code/Cursor marca error en la línea #Requires (módulo ActiveDirectory),
# instale "RSAT: Active Directory module" en Windows o el rol AD DS en el servidor de dominio.
# El script es sintácticamente válido; el analizador no carga módulos del sistema.
<#
.SYNOPSIS
  Procesa pendiente-*.json y crea o actualiza usuarios en Active Directory.

.NOTAS (alineación con el backend Node)
  Cédula (employeeId): validar en Entra ID, procesados, cola pending y AD antes de crear; eso bloquea duplicados de persona.
  pendiente-*.json puede incluir postalCode (obligatorio en backend): se aplica en AD como PostalCode (Set-ADUser).
  sAMAccountName/UPN: alineado con la variante administrativa/LDAP en Node (iterateLocalPartCandidates + truncado 20:
  bases sin número (a)–(d); luego oleada numérica escalonada .1, .2, …). Los operativos M365 usan otra regla (mismo .N por vuelta);
  este script resuelve colisiones en AD con esa secuencia LDAP.
  aquí se resuelve con bucle Get-ADUser hasta encontrar sAM y UPN libres (autoridad final en AD). El JSON puede traer
  samAccountName/userPrincipalName como referencia; el script recalcula la cuenta a partir de nombres/apellidos.
  New-ADUser -Name usa el sAM resuelto (CN único en la OU); DisplayName sigue siendo el nombre completo legible, así dos
  homónimos con distinta cédula no chocan por CN duplicado.

  OU por sede (backend Node): AD_QUEUE_OU_DN + opcional AD_QUEUE_OU_LEAF_PREFIX. Sin prefijo: OU=Medellin|Marmato|Segovia.
  Con prefijo Usuarios-Office365Sync: OU=Usuarios-Office365Sync-Medellin (etc.),<contenedor>. El JSON trae queueMetadata.ouDn
  completo y city = nombre legible en AD (p. ej. Bogotá, Medellín, Lower Mine).

.ESTRUCTURA RECOMENDADA (hermanas bajo la misma raíz, p. ej. C:\scripts o \\srv\scripts):
  pending\      ← QueuePath (este script lee solo aquí)
  procesados\   ← JSON por cédula tras alta exitosa (procesado-employeeId-*.json)
  error\        ← JSON fallidos movidos desde pending
  resultados\   ← resultado-{requestId}.json (status, samAccountName, userPrincipalName, email) para polling del backend/front

  Modo continuo (-Continuous): bucle indefinido que revisa la cola cuando está vacía (por defecto cada 300 ms vía
  -IdleSleepMilliseconds); recomendado con una sola tarea programada «Al iniciar el sistema» en lugar de repetir la tarea cada varios minutos.

  Concurrencia (UNC, backend Node, -Continuous): cada archivo se renombra en la misma carpeta de pendiente-*.json a
  procesando-*.json antes de leerlo (reclamo casi atómico), para reducir carreras donde el archivo «desaparece» entre
  el listado y el Get-Content. No ejecute dos instancias del script sobre la misma cola.

.PARAMETER Continuous
  Si está presente, el script no termina tras una pasada: vuelve a buscar pendiente-*.json tras procesar o, si no hay
  archivos, espera -IdleSleepMilliseconds (o -IdleSleepSeconds si ms=0) y reintenta.

.PARAMETER IdleSleepMilliseconds
  Espera en milisegundos cuando la cola está vacía (solo con -Continuous). Por defecto 300 (~3 comprobaciones/s).
  Si es 0, se usa -IdleSleepSeconds en su lugar.

.PARAMETER IdleSleepSeconds
  Segundos de espera cuando la cola está vacía y -IdleSleepMilliseconds es 0 (solo con -Continuous). Por defecto 1.

.PARAMETER ScriptsRoot
  Raíz explícita (ej. C:\scripts). Si está vacío, se usa el padre de QueuePath vía [System.IO.Path]::GetDirectoryName (más robusto que Split-Path en muchos casos).

.NOTAS DE MIGRACIÓN
  Versiones anteriores guardaban error y resultados bajo pending\error y pending\resultados.
  Ahora van al mismo nivel que pending. Si el backend usa AD_QUEUE_RESULTS_UNC, actualícelo a
  ...\scripts\resultados o defina la variable para la ruta antigua mientras migra.

.EJEMPLO procesado-employeeId-123456.json
  {"cedula":"1234567890","nombreCompleto":"Juan Pérez","fechaCreacion":"2026-04-01T12:00:00.000Z","estado":"creado_en_ad","requestId":"...","samAccountName":"jperez"}
#>
# Parámetros: QueuePath = carpeta con pendiente-*.json; ScriptsRoot = raíz de hermanas (si vacío, padre de QueuePath);
# OrganizationalUnit = OU por defecto si el JSON no trae queueMetadata.ouDn (alinear con queueMetadata.ouDn que envía Node).
# *Subfolder = nombres relativos bajo ScriptsRoot; DefaultCompany = compañía si no viene en el JSON.
param(
    [string]$QueuePath          = 'C:\scripts\pending',
    [string]$ScriptsRoot        = '',
    [string]$OrganizationalUnit = 'OU=Usuarios-Office365Sync-Marmato,OU=Usuarios,DC=prueba,DC=local',
    [string]$ErrorSubfolder     = 'error',
    [string]$ResultsSubfolder   = 'resultados',
    [string]$ProcessedSubfolder = 'procesados',
    [string]$DefaultCompany     = '',
    [switch]$Continuous,
    [ValidateRange(0, 10000)]
    [int]$IdleSleepMilliseconds = 300,
    [ValidateRange(0, 120)]
    [int]$IdleSleepSeconds      = 1
)

# Flujo resumido: lee pendiente-*.json en QueuePath → crea/actualiza usuario en AD → escribe resultados y procesados
# → borra o mueve el JSON. Los errores generan resultado-*.json (status error) y mueven el archivo a la carpeta error.
# Con -Continuous: repite el ciclo (latencia baja frente a tareas programadas cada varios minutos).

Import-Module ActiveDirectory
$ErrorActionPreference = 'Stop'

# Mensaje con marca de tiempo en consola (tareas programadas / depuración).
function Write-QueueLog {
    param([string]$Message, [string]$Level = 'INFO')
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Write-Host "[$ts] [$Level] $Message"
}

# Raíz donde viven carpetas hermanas (pending, procesados, resultados, error). Si ScriptsRoot viene vacío, se infiere del padre de QueuePath.
function Resolve-AdQueueScriptsRoot {
    param(
        [string]$ScriptsRootParam,
        [string]$QueuePathPending
    )
    $sr = $ScriptsRootParam.Trim()
    if (-not [string]::IsNullOrWhiteSpace($sr)) {
        return $sr.TrimEnd('\', '/')
    }
    $q = $QueuePathPending.Trim().TrimEnd('\', '/')
    if ([string]::IsNullOrWhiteSpace($q)) {
        return $null
    }
    $parent = [System.IO.Path]::GetDirectoryName($q)
    if ([string]::IsNullOrWhiteSpace($parent)) {
        return $null
    }
    return $parent.TrimEnd('\')
}

# Sanitiza la cédula para usarla en el nombre del archivo procesado-employeeId-*.json (evita caracteres raros en rutas).
function Get-SafeEmployeeIdFileSuffix {
    param([string]$EmployeeId)
    if ($null -eq $EmployeeId) { return '' }
    return ($EmployeeId.Trim() -replace '[^a-zA-Z0-9_-]', '_')
}

# Ruta completa del JSON de “ya procesado por cédula” (el backend también puede leer esta carpeta).
function Get-AdQueueProcessedRecordFilePath {
    param([string]$ProcessedDir, [string]$EmployeeId)
    $safe = Get-SafeEmployeeIdFileSuffix $EmployeeId
    return (Join-Path $ProcessedDir "procesado-employeeId-$safe.json")
}

# Evita doble alta: si ya existe procesado-employeeId-*.json para esa cédula, no se crea de nuevo en AD.
function Assert-NoProcessedRecordForEmployeeId {
    param([string]$ProcessedDir, [string]$EmployeeId)
    if ([string]::IsNullOrWhiteSpace($EmployeeId)) { return }
    $path = Get-AdQueueProcessedRecordFilePath -ProcessedDir $ProcessedDir -EmployeeId $EmployeeId
    if (Test-Path -LiteralPath $path) {
        throw "El usuario ya está en proceso o fue creado recientemente (cédula registrada en procesados). Revise la carpeta procesados o espere la sincronización con Microsoft Entra ID."
    }
}

# Contraseña inicial fija del script (debe alinearse con políticas de AD); el usuario cambia al primer inicio si ChangePasswordAtLogon.
function New-AdSafePassword {
    return ConvertTo-SecureString "Aris1234*" -AsPlainText -Force
}

# Escapa comodines y comillas para usar valores en -Filter de Get-ADUser (LDAP) sin inyección ni coincidencias accidentales.
function Escape-AdFilterValue {
    param([string]$Value)
    if ($null -eq $Value) { return '' }
    return $Value.Replace('\', '\5c').Replace('*', '\2a').Replace('(', '\28').Replace(')', '\29').Replace("'", "''")
}

# ── Generación de sAM (misma lógica que backend/src/utils/adUsernameHelpers.js) ──
# Quita tildes/diacríticos y deja solo letras minúsculas y números para construir la parte local del logon.
function Normalize-AdNameChunk {
    param([string]$Name)
    if ([string]::IsNullOrWhiteSpace($Name)) { return '' }
    $formD = $Name.Trim().ToLowerInvariant().Normalize([Text.NormalizationForm]::FormD)
    $sb = New-Object System.Text.StringBuilder
    foreach ($ch in $formD.ToCharArray()) {
        $uc = [System.Globalization.CharUnicodeInfo]::GetUnicodeCategory($ch)
        if ($uc -ne [System.Globalization.UnicodeCategory]::NonSpacingMark) { [void]$sb.Append($ch) }
    }
    $normalized = $sb.ToString().Normalize([Text.NormalizationForm]::FormC)
    return ($normalized -creplace '[^a-z0-9]', '')
}

# Parte local del UPN tipo "nombre.apellido" a partir de trozos ya normalizados (sin espacios).
function Get-AdJoinedLocalPart {
    param([string]$Given, [string]$Surname)
    $g = Normalize-AdNameChunk $Given
    $s = Normalize-AdNameChunk $Surname
    if (-not $g -or -not $s) { return $null }
    return "$g.$s"
}

# Recorta la parte local a 20 caracteres (límite clásico de sAMAccountName), respetando sufijos numéricos .N si los hay.
function Truncate-AdSamLocalPart {
    param([string]$LocalPart)
    $max = 20
    if ([string]::IsNullOrWhiteSpace($LocalPart)) { return '' }
    if ($LocalPart.Length -le $max) { return $LocalPart }
    if ($LocalPart -match '^(.+)\.(\d+)$') {
        $base = $Matches[1]
        $suffix = ".$($Matches[2])"
        $maxBase = $max - $suffix.Length
        if ($maxBase -lt 1) {
            return $LocalPart.Substring(0, [Math]::Min($max, $LocalPart.Length))
        }
        $truncBase = if ($base.Length -gt $maxBase) { $base.Substring(0, $maxBase) } else { $base }
        return "$truncBase$suffix"
    }
    return $LocalPart.Substring(0, $max)
}

# Lista ordenada de candidatos (nombre.apellido, variantes con segundo nombre/apellido, luego .1, .2, … por “rondas”) como en Node.
function Get-AdSamLocalPartCandidates {
    param(
        [string]$GivenNameFull,
        [string]$Surname1,
        [string]$Surname2
    )
    $g = $GivenNameFull.Trim()
    $s1 = $Surname1.Trim()
    $s2 = if ($Surname2) { $Surname2.Trim() } else { '' }
    $parts = @($g -split '\s+' | Where-Object { $_ })
    $primaryGiven = if ($parts.Count -gt 0) { $parts[0] } else { $g }
    if ($parts.Count -gt 1) {
        $secondaryGiven = ($parts[1..($parts.Count - 1)] -join ' ').Trim()
        if ([string]::IsNullOrWhiteSpace($secondaryGiven)) { $secondaryGiven = $null }
    } else {
        $secondaryGiven = $null
    }

    $bases = [System.Collections.Generic.List[string]]::new()
    $a = Get-AdJoinedLocalPart $primaryGiven $s1
    if ($a -and -not $bases.Contains($a)) { [void]$bases.Add($a) }
    if ($s2) {
        $b = Get-AdJoinedLocalPart $primaryGiven $s2
        if ($b -and -not $bases.Contains($b)) { [void]$bases.Add($b) }
    }
    if ($secondaryGiven) {
        $c = Get-AdJoinedLocalPart $secondaryGiven $s1
        if ($c -and -not $bases.Contains($c)) { [void]$bases.Add($c) }
        if ($s2) {
            $d = Get-AdJoinedLocalPart $secondaryGiven $s2
            if ($d -and -not $bases.Contains($d)) { [void]$bases.Add($d) }
        }
    }

    $k = $bases.Count
    $list = [System.Collections.Generic.List[string]]::new()
    if ($k -lt 1) { return $list }
    foreach ($b in $bases) { $list.Add($b) }
    $S = 1
    $maxRounds = 100
    for ($round = 0; $round -lt $maxRounds; $round++) {
        for ($i = 0; $i -lt $k; $i++) {
            $n = $S + $round * $k + $i
            $list.Add("$($bases[$i]).$n")
        }
    }
    return $list
}

# Extrae el GUID/id del nombre pendiente-{id}.json si el JSON no trae requestId.
function Get-RequestIdFromPendienteFile {
    param([string]$FileName)
    if ($FileName -match '^pendiente-(.+)\.json$') { return $Matches[1].Trim() }
    return $null
}

<#
  Escribe resultado-{requestId}.json en la carpeta "resultados".
  Lo lee el backend (GET .../queue-requests/:id/result) y el front hace polling.
  Campos clave:
  - status: success | error (pending = archivo aún no existe)
  - displayName: nombre para mostrar final en AD (create y updateByEmployeeId)
  - samAccountName / userPrincipalName / email: valores finales en AD tras crear o actualizar
    (el JSON pendiente puede traer otra propuesta; el script resuelve colisiones de sAM/UPN)
#>
# Escribe un JSON por requestId para que el backend/front consulten el estado del job (éxito o error).
function Write-AdQueueResultFile {
    param(
        [string]$ResultsDir,
        [string]$RequestId,
        [string]$Status,
        [string]$Message,
        [string]$QueueAction = '',
        [string]$SamAccountName = '',
        [string]$UserPrincipalName = '',
        [string]$EmailAddress = '',
        [string]$DisplayName = ''
    )
    if ([string]::IsNullOrWhiteSpace($RequestId)) { return }
    if (-not (Test-Path -LiteralPath $ResultsDir)) {
        try {
            New-Item -ItemType Directory -Path $ResultsDir -Force | Out-Null
        } catch {
            Write-QueueLog "No se pudo crear carpeta de resultados '$ResultsDir': $($_.Exception.Message)" "ERROR"
            return
        }
    }
    $processedAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    $obj = [ordered]@{
        requestId    = $RequestId
        status       = $Status
        message      = $Message
        processedAt  = $processedAt
    }
    if ($QueueAction) { $obj['queueAction'] = $QueueAction }
    if ($SamAccountName) { $obj['samAccountName'] = $SamAccountName }
    if ($UserPrincipalName) { $obj['userPrincipalName'] = $UserPrincipalName.Trim() }
    # Correo principal en AD (proxyAddresses/mail); suele coincidir con UPN si no hay alias distinto
    if ($EmailAddress) { $obj['email'] = $EmailAddress.Trim().ToLowerInvariant() }
    if ($DisplayName) { $obj['displayName'] = $DisplayName.Trim() }
    $outPath = Join-Path $ResultsDir "resultado-$RequestId.json"
    try {
        $json = ($obj | ConvertTo-Json -Depth 5 -Compress) + "`n"
        [System.IO.File]::WriteAllText($outPath, $json, [System.Text.UTF8Encoding]::new($false))
        Write-QueueLog "Resultado escrito: $outPath"
    } catch {
        Write-QueueLog "No se pudo escribir resultado '$outPath': $($_.Exception.Message)" "ERROR"
    }
}

<#
  Registro por cédula tras alta en AD (backend Node lee esta carpeta).
  Archivo: procesado-employeeId-{cedula_sanitizada}.json — UTF-8 sin BOM.
#>
# Marca en disco que esta cédula ya tuvo alta exitosa (anti-duplicados en la siguiente ejecución).
function Write-AdQueueProcessedUserFile {
    param(
        [string]$ProcessedDir,
        [string]$EmployeeId,
        [string]$NombreCompleto,
        [string]$RequestId,
        [string]$SamAccountName
    )
    if ([string]::IsNullOrWhiteSpace($EmployeeId)) { return }
    if ([string]::IsNullOrWhiteSpace($ProcessedDir)) { return }
    $name = Split-Path -Leaf (Get-AdQueueProcessedRecordFilePath -ProcessedDir $ProcessedDir -EmployeeId $EmployeeId)
    if (-not (Test-Path -LiteralPath $ProcessedDir)) {
        try {
            New-Item -ItemType Directory -Path $ProcessedDir -Force | Out-Null
        } catch {
            Write-QueueLog "No se pudo crear carpeta procesados '$ProcessedDir': $($_.Exception.Message)" "ERROR"
            return
        }
    }
    $outPath = Join-Path $ProcessedDir $name
    $obj = [ordered]@{
        cedula         = $EmployeeId.Trim()
        nombreCompleto = $NombreCompleto
        fechaCreacion  = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        estado         = 'creado_en_ad'
        requestId      = $RequestId
        samAccountName = $SamAccountName
    }
    try {
        $json = ($obj | ConvertTo-Json -Depth 5 -Compress) + "`n"
        [System.IO.File]::WriteAllText($outPath, $json, [System.Text.UTF8Encoding]::new($false))
        Write-QueueLog "Registro procesados: $outPath"
    } catch {
        Write-QueueLog "No se pudo escribir procesados '$outPath': $($_.Exception.Message)" "ERROR"
    }
}

# ── Resolver raíz y carpetas hermanas ─────────────────────────────────────────
# error / procesados / resultados quedan al mismo nivel (hermanas de la carpeta que contiene pending), salvo que cambie ScriptsRoot.
$scriptsRootResolved = Resolve-AdQueueScriptsRoot -ScriptsRootParam $ScriptsRoot -QueuePathPending $QueuePath
if ([string]::IsNullOrWhiteSpace($scriptsRootResolved)) {
    Write-QueueLog "No se pudo resolver la raíz de scripts (ScriptsRoot vacío y QueuePath sin directorio padre): '$QueuePath'" "ERROR"
    exit 1
}

$errDir       = Join-Path $scriptsRootResolved $ErrorSubfolder
$resultsDir   = Join-Path $scriptsRootResolved $ResultsSubfolder
$processedDir = Join-Path $scriptsRootResolved $ProcessedSubfolder

Write-QueueLog "Raíz scripts: $scriptsRootResolved | Cola pending: $QueuePath | procesados: $processedDir | resultados: $resultsDir | error: $errDir"

if (-not (Test-Path -LiteralPath $QueuePath)) {
    Write-QueueLog "No existe la carpeta de cola: $QueuePath" "ERROR"
    exit 1
}

# Crea las carpetas de salida si no existen (crítico: sin ellas no se pueden archivar resultados ni errores).
foreach ($dirSpec in @(
        @{ Path = $errDir;       Label = 'error';       Critical = $true },
        @{ Path = $processedDir; Label = 'procesados'; Critical = $true },
        @{ Path = $resultsDir;   Label = 'resultados'; Critical = $true }
    )) {
    if (-not (Test-Path -LiteralPath $dirSpec.Path)) {
        try {
            New-Item -ItemType Directory -Path $dirSpec.Path -Force | Out-Null
            Write-QueueLog "Carpeta $($dirSpec.Label) creada: $($dirSpec.Path)"
        } catch {
            Write-QueueLog "No se pudo crear carpeta $($dirSpec.Label) '$($dirSpec.Path)': $($_.Exception.Message)" "ERROR"
            if ($dirSpec.Critical) { exit 1 }
        }
    }
}

# ── Procesar archivos (una pasada o bucle continuo con -Continuous) ───────────
# Solo archivos que coincidan con el patrón del backend al encolar (pendiente-{requestId}.json).
# Espera en cola vacía (copias locales; no reasignar parámetros del param()).
$effectiveIdleMs = $IdleSleepMilliseconds
$effectiveIdleSec = $IdleSleepSeconds
if ($Continuous) {
    if ($effectiveIdleMs -le 0 -and $effectiveIdleSec -le 0) {
        Write-QueueLog "Modo continuo: defina -IdleSleepMilliseconds (>0) o -IdleSleepSeconds (>0); usando 300 ms." "WARN"
        $effectiveIdleMs = 300
    }
    if ($effectiveIdleMs -gt 0) {
        $idleDescLog = "$effectiveIdleMs ms"
    } else {
        $idleDescLog = "$effectiveIdleSec s"
    }
    Write-QueueLog "Modo continuo activo (espera si cola vacía: $idleDescLog). Ctrl+C para detener."
}

$idleCycles = 0
while ($true) {
    $files = @(Get-ChildItem -LiteralPath $QueuePath -Filter 'pendiente-*.json' -File -ErrorAction SilentlyContinue)

    if ($files.Count -eq 0) {
        if (-not $Continuous) {
            Write-QueueLog "No hay archivos pendientes en $QueuePath"
            exit 0
        }
        $idleCycles++
        # Evita llenar el log: primera vez + cada ~60 ciclos (con 300 ms ≈ 18 s de silencio en log).
        if ($idleCycles -eq 1 -or ($idleCycles % 60) -eq 0) {
            if ($effectiveIdleMs -gt 0) {
                $idleDesc = "$effectiveIdleMs ms"
            } else {
                $idleDesc = "$effectiveIdleSec s"
            }
            Write-QueueLog "Cola vacía en $QueuePath (ciclo inactivo #$idleCycles; siguiente revisión en $idleDesc)."
        }
        if ($effectiveIdleMs -gt 0) {
            Start-Sleep -Milliseconds $effectiveIdleMs
        } else {
            Start-Sleep -Seconds $effectiveIdleSec
        }
        continue
    }

    $idleCycles = 0

    Write-QueueLog "Archivos en cola: $($files.Count)"

foreach ($f in $files) {
    Write-QueueLog "Procesando: $($f.Name)"
    $item = $null
    $requestId = $null
    $claimPath = $null

    if ($f.Name -notmatch '^pendiente-') { continue }
    $claimName = $f.Name -replace '^pendiente-', 'procesando-'
    $claimPath = Join-Path -Path $f.DirectoryName -ChildPath $claimName
    if (Test-Path -LiteralPath $claimPath) {
        Write-QueueLog "Eliminando archivo de trabajo huérfano previo: $claimName" "WARN"
        Remove-Item -LiteralPath $claimPath -Force -ErrorAction SilentlyContinue
    }
    try {
        Rename-Item -LiteralPath $f.FullName -NewName $claimName -ErrorAction Stop
    } catch {
        Write-QueueLog "Omitido (otro proceso, archivo ya movido o red): $($f.Name) — $($_.Exception.Message)" "WARN"
        continue
    }

    try {
        # Cada archivo es un único objeto JSON (campos en español alineados con el backend de cola AD).
        $item = Get-Content -LiteralPath $claimPath -Raw -Encoding UTF8 | ConvertFrom-Json

        if ($item.requestId -and $item.requestId.ToString().Trim()) {
            $requestId = $item.requestId.ToString().Trim()
        } else {
            $requestId = Get-RequestIdFromPendienteFile -FileName $f.Name
        }

        # create = alta nueva; updateByEmployeeId = ajustar datos de un usuario ya existente (misma cédula en AD).
        $queueAction = if ($item.queueAction) { [string]$item.queueAction } else { 'create' }

        if (-not $item.primerNombre)      { throw "Falta campo 'primerNombre'" }
        if (-not $item.primerApellido)    { throw "Falta campo 'primerApellido'" }
        if (-not $item.employeeId -or [string]::IsNullOrWhiteSpace($item.employeeId.ToString())) {
            throw "Falta campo 'employeeId' (cédula / ID)"
        }

        # GivenName / Surname en AD: se arman desde los campos del JSON (pueden incluir segundo nombre o apellido).
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

        $empId = $item.employeeId.ToString().Trim()
        $empIdEsc = Escape-AdFilterValue $empId

        if ($queueAction -eq 'updateByEmployeeId') {
            # No crea cuenta: localiza por EmployeeID (cédula), actualiza nombres/atributos y responde con sAM/UPN/correo actuales.
            # -Properties: necesarios para devolver UPN/correo reales en resultado-{id}.json (misma info que ve el usuario en AD)
            $adUser = Get-ADUser -Filter "EmployeeID -eq '$empIdEsc'" -Properties SamAccountName, UserPrincipalName, EmailAddress -ErrorAction SilentlyContinue
            if (-not $adUser) {
                throw "No se encontró usuario en AD con EmployeeID / cédula: $empId"
            }
            $identity = $adUser.DistinguishedName
            Write-QueueLog "Actualizando usuario AD (EmployeeID=$empId): $($adUser.SamAccountName)"
            $uParams = @{
                Identity    = $identity
                GivenName   = $givenName
                Surname     = $surname
                DisplayName = $displayName
            }
            if ($item.cargo)        { $uParams['Title']       = [string]$item.cargo }
            if ($item.departamento) { $uParams['Department']  = [string]$item.departamento }
            if ($item.city)         { $uParams['City']        = [string]$item.city }
            if ($item.postalCode -and $item.postalCode.ToString().Trim()) {
                $uParams['PostalCode'] = [string]$item.postalCode.ToString().Trim()
            }
            Set-ADUser @uParams
            $upnFinal = [string]$adUser.UserPrincipalName
            $mailFinal = [string]$adUser.EmailAddress
            if ([string]::IsNullOrWhiteSpace($mailFinal)) { $mailFinal = $upnFinal }
            Write-AdQueueResultFile -ResultsDir $resultsDir -RequestId $requestId -Status success `
                -Message "Usuario actualizado en Active Directory." -QueueAction $queueAction `
                -SamAccountName ([string]$adUser.SamAccountName) `
                -UserPrincipalName $upnFinal `
                -EmailAddress $mailFinal `
                -DisplayName $displayName
            Remove-Item -LiteralPath $claimPath -Force
            Write-QueueLog "Usuario actualizado OK: $($adUser.SamAccountName)"
            continue
        }

        if (-not $item.userPrincipalName) { throw "Falta campo 'userPrincipalName' (se usa el dominio para construir el UPN final)" }

        # ── Rama create: nueva cuenta en AD ─────────────────────────────────────
        # 1) Registro local procesados (cédula) — antes de tocar AD
        Assert-NoProcessedRecordForEmployeeId -ProcessedDir $processedDir -EmployeeId $empId

        # 2) Comprobar que no exista ya un objeto AD con esa misma cédula (EmployeeID).
        $idDup = Get-ADUser -Filter "EmployeeID -eq '$empIdEsc'" -ErrorAction SilentlyContinue
        if ($idDup) {
            throw "Ya existe un usuario en Active Directory con la misma cédula / EmployeeID: $empId"
        }

        $upnRaw = $item.userPrincipalName.ToString().Trim()
        if ($upnRaw -notmatch '@') { throw "UPN inválido: '$upnRaw'" }
        # El dominio del UPN final se toma del JSON; la parte local se recalcula en AD hasta encontrar par sAM+UPN libres.
        $upnDomain = ($upnRaw -split '@', 2)[1].ToLowerInvariant()

        $paOnly = $item.primerApellido.Trim()
        $saOpt = if ($item.segundoApellido -and $item.segundoApellido.ToString().Trim()) { $item.segundoApellido.ToString().Trim() } else { '' }
        $candList = Get-AdSamLocalPartCandidates -GivenNameFull $givenName -Surname1 $paOnly -Surname2 $saOpt
        $samResolved = $null
        $upn = $null
        # Primer candidato libre en AD gana (sAM único y UPN único); si todos están ocupados, se lanza error claro.
        foreach ($raw in $candList) {
            if ([string]::IsNullOrWhiteSpace($raw)) { continue }
            $trySam = (Truncate-AdSamLocalPart $raw).ToLowerInvariant()
            if ([string]::IsNullOrWhiteSpace($trySam)) { continue }
            $samEscTry = Escape-AdFilterValue $trySam
            $existsSam = Get-ADUser -Filter "SamAccountName -eq '$samEscTry'" -ErrorAction SilentlyContinue
            if ($existsSam) { continue }
            $tryUpn = "$trySam@$upnDomain"
            $upnEscTry = Escape-AdFilterValue $tryUpn
            $existsUpn = Get-ADUser -Filter "UserPrincipalName -eq '$upnEscTry'" -ErrorAction SilentlyContinue
            if (-not $existsUpn) {
                $samResolved = $trySam
                $upn = $tryUpn
                break
            }
        }
        if (-not $samResolved) {
            throw "No se pudo asignar un sAMAccountName y UPN libres en Active Directory tras agotar las variantes permitidas (misma lógica que usuarios operativos)."
        }
        $sam = $samResolved

        # OU por parámetro del script o override en queueMetadata.ouDn desde el backend.
        $ou = $OrganizationalUnit
        if ($item.queueMetadata -and $item.queueMetadata.ouDn) {
            $ou = [string]$item.queueMetadata.ouDn
        }

        try {
            Get-ADOrganizationalUnit -Identity $ou -ErrorAction Stop | Out-Null
        } catch {
            throw "La OU no existe o no es accesible: '$ou'"
        }

        $upnHintLower = $upnRaw.ToLowerInvariant()
        # EmailAddress en AD: si el JSON trae el mismo valor que el UPN propuesto, se usa el UPN ya resuelto (evita desalinear tras colisión de sAM).
        if ($item.email -and $item.email.ToString().Trim()) {
            $mailHint = $item.email.ToString().Trim().ToLowerInvariant()
            if ($mailHint -eq $upnHintLower) {
                $mail = $upn
            } else {
                $mail = $mailHint
            }
        } else {
            $mail = $upn
        }

        # Company: varias claves posibles en el JSON + valor por defecto del parámetro -DefaultCompany.
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
        Write-QueueLog "Creando usuario '$sam' en OU: $ou (correo: $mail) [cédula=$empId]"

        # Name = CN en la OU: debe ser único; el displayName puede repetirse entre personas distintas (misma cédula no).
        $newParams = @{
            Name                   = $sam
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

        # Atributos que New-ADUser no siempre rellena igual en todas las versiones: se aplican en un segundo paso.
        if ($item.cargo)        { Set-ADUser -Identity $sam -Title       ([string]$item.cargo) }
        if ($item.departamento) { Set-ADUser -Identity $sam -Department  ([string]$item.departamento) }
        if ($item.employeeId)   { Set-ADUser -Identity $sam -EmployeeID   ([string]$item.employeeId) }
        if ($item.city)         { Set-ADUser -Identity $sam -City       ([string]$item.city) }
        if ($item.postalCode -and $item.postalCode.ToString().Trim()) {
            Set-ADUser -Identity $sam -PostalCode ([string]$item.postalCode.ToString().Trim())
        }

        Write-AdQueueProcessedUserFile -ProcessedDir $processedDir -EmployeeId $empId `
            -NombreCompleto $displayName -RequestId $requestId -SamAccountName $sam

        $procWritten = Get-AdQueueProcessedRecordFilePath -ProcessedDir $processedDir -EmployeeId $empId
        if (-not (Test-Path -LiteralPath $procWritten)) {
            Write-QueueLog "CRÍTICO: Usuario '$sam' creado en AD pero no se pudo confirmar el archivo en procesados para cédula $empId. Revise permisos y disco." "ERROR"
        }

        # Incluir nombre para mostrar, UPN y correo definitivos (pueden diferir del pendiente-*.json si hubo colisión de sAM)
        Write-AdQueueResultFile -ResultsDir $resultsDir -RequestId $requestId -Status success `
            -Message "Usuario creado en Active Directory." -QueueAction $queueAction -SamAccountName $sam `
            -UserPrincipalName $upn -EmailAddress $mail -DisplayName $displayName
        Remove-Item -LiteralPath $claimPath -Force
        Write-QueueLog "Usuario creado OK: $sam"

    } catch {
        # Fallo: log + resultado error para polling + mover JSON a carpeta error (si el archivo sigue en cola).
        $errorMsg = $_.Exception.Message
        Write-QueueLog "FALLO procesando '$($f.Name)': $errorMsg" "ERROR"

        $failRequestId = Get-RequestIdFromPendienteFile -FileName $f.Name
        $failQueueAction = ''
        if ($item -and $item.queueAction) { $failQueueAction = [string]$item.queueAction }
        if ($failRequestId) {
            Write-AdQueueResultFile -ResultsDir $resultsDir -RequestId $failRequestId -Status error `
                -Message $errorMsg -QueueAction $failQueueAction
        }

        try {
            if (-not (Test-Path -LiteralPath $errDir)) {
                New-Item -ItemType Directory -Path $errDir -Force | Out-Null
            }
            $dest = Join-Path $errDir $f.Name
            $sourceForError = if ($claimPath -and (Test-Path -LiteralPath $claimPath)) { $claimPath } elseif (Test-Path -LiteralPath $f.FullName) { $f.FullName } else { $null }
            if ($sourceForError) {
                Move-Item -LiteralPath $sourceForError -Destination $dest -Force
                Write-QueueLog "Archivo movido a error: $dest"
            } else {
                Write-QueueLog "El archivo ya no existe en cola (ni pendiente ni procesando), no se puede mover: $($f.Name)" "WARN"
            }
        } catch {
            Write-QueueLog "No se pudo mover '$($f.Name)' a error: $($_.Exception.Message)" "ERROR"
        }
    }
}

    if (-not $Continuous) {
        break
    }
    # Siguiente vuelta del bucle: recoge nuevos pendiente-*.json que hayan llegado mientras se procesaba.
}

Write-QueueLog "Procesamiento finalizado."
