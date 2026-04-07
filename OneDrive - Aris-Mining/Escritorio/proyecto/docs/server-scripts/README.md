# Scripts en el servidor (Active Directory)

## `Process-AdUserQueue.ps1`

El backend Node escribe archivos `pendiente-{uuid}.json` en la ruta UNC definida por `AD_QUEUE_UNC`. Este script debe ejecutarse **en el servidor** (o en un equipo con módulo **ActiveDirectory** y permisos para crear usuarios en la OU), de forma periódica.

### Requisitos

- Windows Server o Windows con RSAT **Active Directory module for Windows PowerShell**
- Cuenta de la tarea programada con permisos para `New-ADUser` en la OU destino
- Lectura/escritura en la carpeta de cola (misma UNC que usa Node, o copia local sincronizada)

### Ejemplo de Tarea programada

1. Copiar `Process-AdUserQueue.ps1` a `C:\scripts\` en el servidor.
2. Abrir **Programador de tareas** (`taskschd.msc`) → **Crear tarea** (no tarea básica).
3. **General**: ejecutar tanto si el usuario inició sesión como si no; usuario con permisos en AD.

### Frecuencia del desencadenador (latencia de la cola)

El backend solo escribe archivos en `pending`; hasta que esta tarea **no ejecute** el script, no hay alta en AD. El intervalo de repetición acota el **tiempo máximo de espera** (p. ej. con 5 minutos una solicitud puede tardar casi 5 minutos aunque el script solo tarde segundos).

**Intervalos recomendados**

| Intervalo | Uso típico |
|-----------|------------|
| **1 minuto** | Equilibrio entre rapidez y carga en el servidor y el controlador de dominio. |
| **30 segundos** | Máxima rapidez percibida; adecuado si el volumen es bajo. |
| **5 minutos** | Muy bajo volumen o políticas que limitan ejecuciones frecuentes. |

**Pasos en el Programador de tareas (frecuencia y concurrencia)**

a. Pestaña **Desencadenadores** → seleccionar o crear un desencadenador (p. ej. al iniciar el sistema, o una vez al día con repetición).
b. **Editar** el desencadenador → en la zona avanzada, activar **Repetir la tarea cada:** y elegir **1 minuto** (o **30 segundos**, etc.).
c. **Durante un periodo de:** **Indefinidamente** (o acotar al horario laboral si aplica).
d. Pestaña **Configuración**: en **Si la tarea ya se está ejecutando, aplicar la siguiente regla**, elija **No iniciar una nueva instancia**. Así se evitan dos procesos simultáneos sobre la misma carpeta `pending` y posibles condiciones de carrera.
e. Aceptar los cuadros de diálogo. Para probar de inmediato: clic derecho en la tarea → **Ejecutar**.

### Acciones y resto de opciones

4. **Acciones** → **Iniciar un programa**:
   - Programa: `powershell.exe`
   - Argumentos (ajustar rutas y OU):

```text
-NoProfile -ExecutionPolicy Bypass -File "C:\scripts\Process-AdUserQueue.ps1" -QueuePath "\\10.10.11.9\scripts\pending" -OrganizationalUnit "OU=Administrativos,DC=corp,DC=local" -DefaultCompany "Mi Empresa"
```

5. Si el JSON incluye `queueMetadata.ouDn` (por `AD_QUEUE_OU_DN` en Node), ese DN tiene prioridad sobre `-OrganizationalUnit`.

6. **Correo y organización en AD:** el script asigna `-EmailAddress` con el campo `email` del JSON (si falta, usa el UPN). El atributo **Company** se toma de `empresa` (env `AD_QUEUE_COMPANY` en Node), o `company` en el JSON, o `queueMetadata.company`, o `-DefaultCompany` en la tarea.

7. **Cédula / ID:** el JSON debe incluir **`employeeId`** (obligatorio). El script rechaza duplicados en AD (`EmployeeID`) antes de crear el usuario.

**Nota (backend Node):** la limpieza de archivos en `procesados` frente a Microsoft Graph (`AD_PROCESSED_GRAPH_SYNC_INTERVAL_MS` en el backend, por defecto ~60 s) es un proceso **aparte** del script AD; no sustituye esta tarea programada.

### Errores

Los JSON que fallen se mueven a la subcarpeta `error\` junto a un `.log` con el mensaje. Corrija la causa y vuelva a colocar un JSON corregido manualmente si aplica.

### Contraseña

El script del repo usa por defecto la contraseña fija **Aris1234*** (alineada con usuarios operativos M365); cámbiela en `New-AdSafePassword` si su política lo exige. Si el backend envía `queueMetadata.initialPasswordFromQueue` (`AD_QUEUE_INITIAL_PASSWORD` en Node), puede adaptar el script para usarla; evite contraseñas en claro salvo política explícita.
