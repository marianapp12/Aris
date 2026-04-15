# Scripts en el servidor (Active Directory)

## `Process-AdUserQueue.ps1`

El backend Node escribe archivos `pendiente-{uuid}.json` en la ruta UNC definida por `AD_QUEUE_UNC`. Este script debe ejecutarse **en el servidor** (o en un equipo con módulo **ActiveDirectory** y permisos para crear usuarios en la OU).

**Recomendado (baja latencia):** modo continuo `-Continuous`: una sola tarea programada **al iniciar el sistema** deja el script en bucle revisando la cola cuando está vacía (por defecto cada **300 ms**). Así las solicitudes se procesan en segundos.

### Si la interfaz “tarda ~5 minutos” o más

Eso casi siempre significa que **el script no se ejecuta hasta la siguiente pasada** de una tarea programada (p. ej. cada 5 minutos) o que el script **no está en marcha**. **No** se arregla solo acelerando la web: hay que **activar `-Continuous`** en el servidor (o repetir la tarea cada 1 minuto como mínimo). La aplicación solo consulta el archivo `resultado-*.json` cuando el script ya lo ha generado.

**Alternativa:** ejecutar el script sin `-Continuous` desde una tarea que se repite cada *N* minutos (el intervalo acota el tiempo máximo de espera hasta la primera pasada).

### Requisitos

- Windows Server o Windows con RSAT **Active Directory module for Windows PowerShell**
- Cuenta de la tarea programada con permisos para `New-ADUser` en la OU destino
- Lectura/escritura en la carpeta de cola (misma UNC que usa Node, o copia local sincronizada)

### Parámetros del script (resumen)

| Parámetro | Descripción |
|-----------|-------------|
| `-Continuous` | Bucle indefinido: tras procesar (o si la cola está vacía) vuelve a escanear. Use con **una** tarea al inicio del sistema. |
| `-IdleSleepMilliseconds` | Espera cuando la cola está vacía (solo con `-Continuous`). Por defecto **300** ms. Rango 0–10000; si es **0**, se usa `-IdleSleepSeconds`. |
| `-IdleSleepSeconds` | Reserva si `IdleSleepMilliseconds` es 0 (p. ej. `-IdleSleepMilliseconds 0 -IdleSleepSeconds 1`). Por defecto **1**. |
| Sin `-Continuous` | Una sola pasada: procesa todos los `pendiente-*.json` presentes y termina (adecuado si la tarea se repite cada *N* minutos). |

### Ejemplo de Tarea programada (modo continuo, recomendado)

1. Copiar `Process-AdUserQueue.ps1` a `C:\scripts\` en el servidor.
2. Abrir **Programador de tareas** (`taskschd.msc`) → **Crear tarea** (no tarea básica).
3. **General**: ejecutar tanto si el usuario inició sesión como si no; cuenta de usuario con permisos en AD y en la UNC.
4. **Desencadenadores** → **Nuevo** → **Al iniciar el sistema** (o **Al iniciar sesión** si no usáis cuenta de servicio).
5. **Configuración** → **Si la tarea falla, reiniciar cada:** 1 minuto (reintentos limitados), para recuperar el proceso si hubo un error puntual.
6. **Si la tarea ya se está ejecutando:** **No iniciar una nueva instancia** (evita dos bucles sobre la misma cola).

**Acción** → **Iniciar un programa**:

- Programa: `powershell.exe`
- Argumentos (añadir **`-Continuous`**; ajustar rutas y OU):

```text
-NoProfile -ExecutionPolicy Bypass -File "C:\scripts\Process-AdUserQueue.ps1" -Continuous -IdleSleepMilliseconds 300 -QueuePath "\\10.10.11.9\scripts\pending" -OrganizationalUnit "OU=Usuarios-Office365Sync-Marmato,OU=Usuarios,DC=corp,DC=local" -DefaultCompany "Mi Empresa"
```

Para probar: clic derecho en la tarea → **Ejecutar**. Para detener el bucle: finalizar el proceso `powershell` asociado o deshabilitar la tarea.

### Tarea periódica (sin modo continuo)

Si no usáis `-Continuous`, el script **termina** tras una pasada. El intervalo de la tarea acota el **tiempo máximo de espera** hasta que alguien procese la cola (p. ej. con 5 minutos puede tardar casi 5 minutos en el peor caso).

| Intervalo | Uso típico |
|-----------|------------|
| **1 minuto** | Equilibrio entre rapidez y carga. |
| **30 segundos** | Más rápido; bajo volumen. |
| **5 minutos** | Muy bajo volumen o políticas restrictivas. |

Desencadenador con **Repetir la tarea cada** *N* + **No iniciar una nueva instancia** si la ejecución anterior sigue en curso.

Argumentos **sin** `-Continuous`:

```text
-NoProfile -ExecutionPolicy Bypass -File "C:\scripts\Process-AdUserQueue.ps1" -QueuePath "\\10.10.11.9\scripts\pending" -OrganizationalUnit "OU=Usuarios-Office365Sync-Marmato,OU=Usuarios,DC=corp,DC=local" -DefaultCompany "Mi Empresa"
```

### OU, correo y cédula

- **OU y sede:** el backend construye `queueMetadata.ouDn` con **`AD_QUEUE_OU_DN`** y, si define **`AD_QUEUE_OU_LEAF_PREFIX`** (p. ej. `Usuarios-Office365Sync`), como `OU=Usuarios-Office365Sync-Medellin|...-Marmato|...-Segovia,<contenedor>`. Sin prefijo: `OU=Medellin|...,<contenedor>`. Ese `ouDn` tiene prioridad sobre `-OrganizationalUnit`. Si el JSON no trae `queueMetadata.ouDn`, se usa `-OrganizationalUnit` (debe coincidir con la estructura real del AD).

- **Correo y organización en AD:** el script asigna `-EmailAddress` con el campo `email` del JSON (si falta, usa el UPN). El atributo **Company** se toma de `empresa` (env `AD_QUEUE_COMPANY` en Node), o `company` en el JSON, o `queueMetadata.company`, o `-DefaultCompany` en la tarea.

- **Cédula / ID:** el JSON debe incluir **`employeeId`** (obligatorio). El script rechaza duplicados en AD (`EmployeeID`) antes de crear el usuario.

**Nota (backend Node):** la limpieza de archivos en `procesados` frente a Microsoft Graph (`AD_PROCESSED_GRAPH_SYNC_INTERVAL_MS` en el backend, por defecto ~60 s) es un proceso **aparte** del script AD; no sustituye esta tarea programada.

### Plantilla Excel administrativos

Para regenerar `frontend/public/plantilla-administrativos.xlsx` con el ejemplo de fila, desde la carpeta `backend` ejecute:

`node scripts/generatePlantillaAdministrativos.mjs`

**No ejecute** ese comando sobre una plantilla que ya haya editado en Excel con formato (colores, tablas, etc.): **machaca el archivo** y solo deja datos mínimos (SheetJS no conserva estilos). Para una plantilla corporativa estilizada, guárdela con otro nombre o en otra ruta, o configure en el frontend `VITE_PLANTILLA_ADMINISTRATIVOS_URL` con un enlace HTTPS (p. ej. SharePoint) y no dependa del archivo en `public/`.

### Errores

Los JSON que fallen se mueven a la subcarpeta `error\` junto a un `.log` con el mensaje. Corrija la causa y vuelva a colocar un JSON corregido manualmente si aplica.

### El editor marca muchos errores en el `.ps1`

- **`#Requires -Modules ActiveDirectory`**: en un PC sin RSAT / sin rol AD, el analizador de PowerShell en VS Code no “ve” el módulo; es un **falso positivo** hasta instalar el módulo o ejecutar el script en el servidor de dominio.
- Ejecute en consola (en el servidor): `powershell -NoProfile -Command "Get-Module -ListAvailable ActiveDirectory"` — si aparece, el script podrá cargarse allí.

### Contraseña

El script del repo usa por defecto la contraseña fija **Aris1234*** (alineada con usuarios operativos M365); cámbiela en `New-AdSafePassword` si su política lo exige. Si el backend envía `queueMetadata.initialPasswordFromQueue` (`AD_QUEUE_INITIAL_PASSWORD` en Node), puede adaptar el script para usarla; evite contraseñas en claro salvo política explícita.
