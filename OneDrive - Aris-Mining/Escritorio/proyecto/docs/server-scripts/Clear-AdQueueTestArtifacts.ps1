<#
.SYNOPSIS
  Borra JSON de prueba en las carpetas de la cola AD/M365 (pending, resultados, procesados, error).

.DESCRIPTION
  Alineado con Process-AdUserQueue.ps1 y backend AD_QUEUE_UNC.
  NO elimina usuarios en Active Directory ni Microsoft 365.

.PARAMETER QueuePath
  Carpeta pending (por defecto la misma que en .env: \\192.168.101.13\scripts\pending).

.PARAMETER ScriptsRoot
  Raíz explícita (ej. \\192.168.101.13\scripts). Si está vacío, se infiere del padre de QueuePath.

.PARAMETER WhatIf
  Solo muestra qué se borraría, sin eliminar archivos.

.PARAMETER Force
  Obligatorio para borrar de verdad (evita ejecuciones accidentales).

.EXAMPLE
  .\Clear-AdQueueTestArtifacts.ps1 -WhatIf

.EXAMPLE
  .\Clear-AdQueueTestArtifacts.ps1 -Force

.EXAMPLE
  .\Clear-AdQueueTestArtifacts.ps1 -ScriptsRoot '\\192.168.101.13\scripts' -Force
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$QueuePath          = '\\192.168.101.13\scripts\pending',
    [string]$ScriptsRoot        = '',
    [string]$ResultsSubfolder   = 'resultados',
    [string]$ProcessedSubfolder = 'procesados',
    [string]$ErrorSubfolder     = 'error',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Write-ClearLog {
    param([string]$Message, [string]$Level = 'INFO')
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Write-Host "[$ts] [$Level] $Message"
}

function Resolve-ScriptsRoot {
    param([string]$ScriptsRootParam, [string]$QueuePathPending)
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

function Get-QueueJsonFiles {
    param([string]$Dir)
    if (-not (Test-Path -LiteralPath $Dir)) {
        return @()
    }
    Get-ChildItem -LiteralPath $Dir -File -ErrorAction SilentlyContinue |
        Where-Object {
            $n = $_.Name
            $n -match '\.json$' -or $n -eq 'ok'
        }
}

$root = Resolve-ScriptsRoot -ScriptsRootParam $ScriptsRoot -QueuePathPending $QueuePath
if (-not $root) {
    throw "No se pudo resolver ScriptsRoot. Use -ScriptsRoot o -QueuePath apuntando a ...\pending"
}

$pendingDir   = $QueuePath.Trim().TrimEnd('\', '/')
$resultsDir   = Join-Path $root $ResultsSubfolder
$processedDir = Join-Path $root $ProcessedSubfolder
$errorDir     = Join-Path $root $ErrorSubfolder

$targets = @(
    @{ Label = 'pending';    Path = $pendingDir;   Note = 'pendiente-*, procesando-*, .reservado-m365-*, ok' },
    @{ Label = 'resultados'; Path = $resultsDir;   Note = 'resultado-*, resultado-operativo-m365-*' },
    @{ Label = 'procesados'; Path = $processedDir; Note = 'procesado-employeeId-*' },
    @{ Label = 'error';      Path = $errorDir;     Note = 'JSON de fallos movidos desde pending' }
)

Write-ClearLog "Raíz scripts: $root"
Write-ClearLog "Modo: $(if ($Force) { 'BORRAR' } else { 'SIMULACIÓN (añada -Force para eliminar)' })"
Write-Host ''
Write-Host 'IMPORTANTE:'
Write-Host '  - Esto NO borra usuarios en M365 ni en Active Directory.'
Write-Host '  - Reinicie el backend (npm run dev) tras limpiar: Node guarda reservas M365 en memoria.'
Write-Host '  - Detenga Process-AdUserQueue.ps1 un momento si está en -Continuous, para evitar carreras.'
Write-Host ''

$total = 0
foreach ($t in $targets) {
    $files = @(Get-QueueJsonFiles -Dir $t.Path)
    Write-ClearLog "$($t.Label) [$($t.Path)] — $($files.Count) archivo(s). $($t.Note)"
    foreach ($f in $files) {
        $total++
        $rel = $f.FullName
        if ($Force) {
            if ($PSCmdlet.ShouldProcess($rel, 'Remove file')) {
                Remove-Item -LiteralPath $f.FullName -Force
                Write-ClearLog "  eliminado: $($f.Name)"
            }
        } else {
            Write-ClearLog "  [WhatIf] $($f.Name)"
        }
    }
}

Write-Host ''
if (-not $Force) {
    Write-ClearLog "Simulación: $total archivo(s). Ejecute con -Force para borrarlos." 'WARN'
} else {
    Write-ClearLog "Listo: se eliminaron $total archivo(s)." 'INFO'
    Write-ClearLog 'Puede volver a crear operativo y luego administrativo para probar UPN distintos.'
}
