# Scripts en el servidor (Active Directory)

## `Process-AdUserQueue.ps1`

El backend Node escribe archivos `pendiente-{uuid}.json` en la ruta UNC definida por `AD_QUEUE_UNC`. Este script debe ejecutarse **en el servidor** (o en un equipo con módulo **ActiveDirectory** y permisos para crear usuarios en la OU), de forma periódica.

### Requisitos

- Windows Server o Windows con RSAT **Active Directory module for Windows PowerShell**
- Cuenta de la tarea programada con permisos para `New-ADUser` en la OU destino
- Lectura/escritura en la carpeta de cola (misma UNC que usa Node, o copia local sincronizada)

### Ejemplo de Tarea programada

1. Copiar `Process-AdUserQueue.ps1` a `C:\scripts\` en el servidor.
2. Abrir **Programador de tareas** → **Crear tarea** (no tarea básica).
3. **General**: ejecutar tanto si el usuario inició sesión como si no; usuario con permisos en AD.
4. **Desencadenadores**: repetir cada **5 minutos** (o 1–5 min según volumen).
5. **Acciones** → **Iniciar un programa**:
   - Programa: `powershell.exe`
   - Argumentos (ajustar rutas y OU):

```text
-NoProfile -ExecutionPolicy Bypass -File "C:\scripts\Process-AdUserQueue.ps1" -QueuePath "\\10.10.11.9\scripts\pending" -OrganizationalUnit "OU=Administrativos,DC=corp,DC=local" -DefaultCompany "Mi Empresa"
```

6. Si el JSON incluye `queueMetadata.ouDn` (por `AD_QUEUE_OU_DN` en Node), ese DN tiene prioridad sobre `-OrganizationalUnit`.

7. **Correo y organización en AD:** el script asigna `-EmailAddress` con el campo `email` del JSON (si falta, usa el UPN). El atributo **Company** se toma de `empresa` (env `AD_QUEUE_COMPANY` en Node), o `company` en el JSON, o `queueMetadata.company`, o `-DefaultCompany` en la tarea.

8. **Cédula / ID:** el JSON debe incluir **`employeeId`** (obligatorio). El script rechaza duplicados en AD (`EmployeeID`) antes de crear el usuario.

### Errores

Los JSON que fallen se mueven a la subcarpeta `error\` junto a un `.log` con el mensaje. Corrija la causa y vuelva a colocar un JSON corregido manualmente si aplica.

### Contraseña

El script del repo usa por defecto la contraseña fija **Aris1234*** (alineada con usuarios operativos M365); cámbiela en `New-AdSafePassword` si su política lo exige. Si el backend envía `queueMetadata.initialPasswordFromQueue` (`AD_QUEUE_INITIAL_PASSWORD` en Node), puede adaptar el script para usarla; evite contraseñas en claro salvo política explícita.
