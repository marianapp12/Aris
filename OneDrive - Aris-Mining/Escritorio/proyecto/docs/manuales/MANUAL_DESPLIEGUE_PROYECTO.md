# Anexo 6. Manual de Despliegue

## Manual de Despliegue - Sistema Aris (Sin Docker)

## Contenido
- 1. Introducción
- 2. Arquitectura de Despliegue
- 3. Requisitos del Sistema
- 4. Variables de Entorno
- 5. Instalación Local
- 6. Despliegue en Servidor
- 7. Configuración del AD (PowerShell)
- 8. Pruebas de Humo (Smoke Test)
- 9. Troubleshooting Operativo

## 1. Introducción

Este manual describe el despliegue del sistema Aris según la implementación actual del repositorio.

El sistema permite:
- Crear usuarios operativos en Microsoft 365 mediante Microsoft Graph.
- Encolar solicitudes de usuarios administrativos para Active Directory (AD) por medio de archivos JSON en una carpeta compartida.
- Procesar la cola AD con un script PowerShell ejecutado en el servidor.

## 2. Arquitectura de Despliegue

El despliegue se compone de tres partes:

- Frontend: aplicación React + Vite (build estático).
- Backend: API REST en Node.js + Express.
- Worker AD: script `Process-AdUserQueue.ps1` ejecutado en servidor con módulo ActiveDirectory.

Flujo administrativo resumido:
1. El backend escribe `pendiente-{uuid}.json` en `AD_QUEUE_UNC`.
2. El worker PowerShell procesa la cola y ejecuta `New-ADUser`.
3. El resultado se guarda en carpetas de resultados/procesados/error según corresponda.

Puertos y conectividad relevantes:
- Frontend local (dev): `3000`.
- Backend API: `5000` por defecto (`PORT` configurable).
- SMB para carpeta compartida UNC: puerto `445`.
- Salida HTTPS a Microsoft Graph desde backend.

## 3. Requisitos del Sistema

### 3.1 Hardware y Sistema Operativo

- Entorno de desarrollo: Windows 10/11.
- Servidor para backend: Windows 
- Servidor AD: Windows con módulo ActiveDirectory y permisos sobre la OU destino.

### 3.2 Software Base

- Node.js 20 (alineado con `.nvmrc`).
- npm 10 o superior (recomendado).
- PowerShell 5.1+ en servidor AD.
- Módulo ActiveDirectory para PowerShell.
- Python 3.10+ (solo si va a usar entorno virtual y utilidades Python locales).

### 3.3 Prerrequisitos de Acceso (detallado)

Antes de desplegar, deje listos estos accesos:

#### 3.3.1 Aplicación en Azure / Entra ID (obligatorio para backend y frontend)

1. Ingrese al portal de Azure: [https://portal.azure.com](https://portal.azure.com).
2. Vaya a **Microsoft Entra ID** -> **App registrations** -> **New registration**.
3. Asigne un nombre (ejemplo: `Aris-Prod-App`) y cree la aplicación.
4. Guarde los siguientes valores:
   - `Directory (tenant) ID` -> se usa como `AZURE_TENANT_ID` y `VITE_AZURE_TENANT_ID`.
   - `Application (client) ID` -> se usa como `AZURE_CLIENT_ID` y `VITE_AZURE_CLIENT_ID`.
5. Vaya a **Certificates & secrets** -> **New client secret**:
   - Copie el **Value** del secreto (solo se muestra una vez).
   - Guarde ese valor como `AZURE_CLIENT_SECRET`.
6. Vaya a **API permissions** -> **Add a permission** -> **Microsoft Graph** -> **Application permissions**.
7. Agregue como mínimo:
   - `User.ReadWrite.All`
8. Si van a usar asignación de grupos por sede para operativos, agregue también:
   - `GroupMember.ReadWrite.All`
   - `Group.Read.All` (recomendado para mostrar nombres de grupo en UI)
9. Presione **Grant admin consent** para el tenant.

Checklist rápido de validación:
- La app aparece en Entra con estado activo.
- `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` están cargados en `backend/.env`.
- Se otorgó `Admin consent` para los permisos de Graph.

#### 3.3.2 Acceso a recurso compartido UNC (flujo administrativo)

- La ruta `AD_QUEUE_UNC` debe existir y estar accesible desde el equipo/servidor donde corre el backend.
- La cuenta que ejecuta Node debe tener permisos de escritura en la carpeta `pending`.
- Debe existir conectividad SMB (puerto 445) entre backend y servidor de archivos.

#### 3.3.3 Cuenta de servicio para worker AD

- Crear o usar cuenta de servicio de dominio para la tarea programada.
- Otorgar permisos para crear usuarios en la OU objetivo.
- Otorgar permisos de lectura/escritura en carpeta de cola y subcarpetas de resultado/error/procesados.

### 3.4 Entorno virtual Python (opcional en desarrollo)

La creación y activación del entorno virtual se realiza dentro de la sección `5.2`, justo después de clonar el proyecto.

## 4. Variables de Entorno

## 4.1 Backend (`backend/.env`)

Crear `backend/.env` a partir de `backend/.env.example`.

### Obligatorias (mínimo funcional)

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `NODE_ENV`
- `AD_QUEUE_UNC` (si se usa flujo administrativo)
- `AD_QUEUE_EMAIL_DOMAIN` (si se usa flujo administrativo)

Ejemplo mínimo funcional:

```env
AZURE_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
PORT=5000
NODE_ENV=development

AD_QUEUE_UNC=\\servidor\scripts\pending
AD_QUEUE_EMAIL_DOMAIN=empresa.co
AD_QUEUE_OU_DN=OU=Usuarios,DC=empresa,DC=local
```

### Recomendadas para producción

- `CORS_ORIGIN`
- `AD_QUEUE_OU_DN`
- `AD_QUEUE_OU_LEAF_PREFIX` (si aplica convención por sede)
- `AD_QUEUE_RESULTS_UNC`
- `AD_QUEUE_PROCESSED_UNC`
- `AD_QUEUE_CONNECTION_TEST_TIMEOUT_MS`
- `GROUP_MEDELLIN_ID`, `GROUP_SEGOVIA_ID`, `GROUP_MARMATO_ID`, `GROUP_BOGOTA_ID`, `GROUP_BUCARAMANGA_ID` (si se asignan grupos por sede)
- `OPERATIONAL_COMMON_GROUP_IDS`
- `OPERATIONAL_COMMON_GROUP_DISPLAY_NAMES`

### Opcionales para prechequeo LDAP (alta administrativa robusta)

- `AD_LDAP_URL`
- `AD_LDAP_BIND_DN`
- `AD_LDAP_BIND_PASSWORD`
- `AD_LDAP_SEARCH_BASE`
- `AD_LDAP_TIMEOUT_MS`
- `AD_LDAP_CONNECT_TIMEOUT_MS`

Errores comunes en backend:
- `AZURE_CLIENT_SECRET` vencido o mal copiado -> falla autenticación contra Graph.
- `AD_QUEUE_UNC` inválida o sin permisos -> error al encolar administrativos.
- `CORS_ORIGIN` no configurado en producción -> bloqueo de llamadas desde frontend.

## 4.2 Frontend (`frontend/.env`)

Crear `frontend/.env` a partir de `frontend/.env.example`.

### Obligatorias

- `VITE_API_BASE_URL`
- `VITE_AZURE_TENANT_ID`
- `VITE_AZURE_CLIENT_ID`
- `VITE_AZURE_LOGI_GROUP_ID`
- `VITE_PLANTILLA_OPERARIOS_URL` (URL `https` a la plantilla Excel de operarios, p. ej. SharePoint)
- `VITE_PLANTILLA_ADMINISTRATIVOS_URL` (URL `https` a la plantilla Excel de administrativos)

Ejemplo mínimo funcional:

```env
VITE_API_BASE_URL=/api
VITE_AZURE_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
VITE_AZURE_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
VITE_AZURE_LOGI_GROUP_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
VITE_PLANTILLA_OPERARIOS_URL=https://suempresa.sharepoint.com/.../plantilla-operarios.xlsx
VITE_PLANTILLA_ADMINISTRATIVOS_URL=https://suempresa.sharepoint.com/.../plantilla-administrativos.xlsx
```

Nota: toda variable `VITE_*` se inyecta en el **build**. Si cambia, es necesario reconstruir el frontend.

Errores comunes en frontend:
- `VITE_API_BASE_URL` sin `/api` en desarrollo puede apuntar a rutas equivocadas.
- `VITE_AZURE_*` incorrectas provoca fallos de login MSAL.
- Cambiar `.env` y no reiniciar `npm run dev` impide ver cambios.

## 5. Instalación Local

## 5.1 Paso 1 - Clonar repositorio

1. Abra Visual Studio Code.
2. Abra una terminal **PowerShell** dentro de Visual Studio Code.
3. Ejecute:

```powershell
git clone https://github.com/marianapp12/Aris.git
cd Aris
```

## 5.2 Paso 2 - (Opcional) Crear entorno virtual Python

Este paso es opcional y solo aplica si necesita utilidades Python en su equipo local.

### 5.2.1 Instalar Python (si no lo tiene)

1. Descargue Python desde [https://www.python.org/downloads/windows/](https://www.python.org/downloads/windows/).
2. Ejecute el instalador y marque **Add python.exe to PATH**.
3. Finalice la instalación y cierre/abra de nuevo la terminal.
4. Verifique:

```powershell
python --version
pip --version
```

### 5.2.2 Crear y activar entorno virtual

Desde la raiz del proyecto (`Aris`), ejecute:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

Validación:
- Debe ver `(.venv)` al inicio de la terminal.

Si PowerShell bloquea scripts:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

Luego cierre/abra terminal y active de nuevo:

```powershell
.\.venv\Scripts\Activate.ps1
```

Para desactivar:

```powershell
deactivate
```


## 5.3 Paso 3 - Instalar y configurar backend

```powershell
cd C:\ruta\Aris\backend
npm install
```

Completar `backend/.env` con credenciales reales y configuración AD según el numeral 4.1.

## 5.4 Paso 4 - Instalar y configurar frontend

```powershell
cd C:\ruta\Aris\frontend
npm install
```

Completar `frontend/.env` según el numeral 4.2.

Valor recomendado en desarrollo:
- `VITE_API_BASE_URL=/api`

## 5.5 Paso 5 - Ejecutar en desarrollo (al final)

Abra **2 terminales PowerShell** en Visual Studio Code.

### Terminal 1 - PowerShell de Visual Studio Code (Backend)

```powershell
cd C:\ruta\Aris\backend
npm run dev
```

Resultado esperado:
- API arriba en `http://localhost:5000`

### Terminal 2 - PowerShell de Visual Studio Code (Frontend)

```powershell
cd C:\ruta\Aris\frontend
npm run dev
```

Resultado esperado:
- Frontend arriba en `http://localhost:3000`
- El frontend consume backend por proxy `/api`

Si falla:
- Confirme que el backend sigue corriendo en la Terminal 1.
- Revise `VITE_API_BASE_URL=/api` en `frontend/.env`.


## 6. Despliegue en Servidor

## 6.0 Carpetas mínimas en el servidor

Antes de publicar backend y frontend, defina dónde vivirá cada pieza y, si usa altas administrativas, la estructura de la cola SMB. Los permisos de la UNC se detallan en **§3.3.2**; el worker PowerShell en **§7**.

### Solo operativos (Microsoft Graph, sin cola AD)

- **Backend:** un directorio de despliegue con el código del repositorio en `backend/` y `node_modules` tras `npm install` (no se requieren carpetas vacías adicionales en el API: el backend no persiste archivos en disco para este flujo).
- **Frontend:** el directorio raíz del sitio estático debe contener el **contenido** de `frontend/dist` generado con `npm run build` (IIS, Nginx u otro hosting equivalente).

### Con usuarios administrativos (cola SMB + worker PowerShell)

En el **recurso compartido** que ve el servidor del API (misma ruta que `AD_QUEUE_UNC`), use una raíz común y cuatro carpetas **hermanas**. Convención del repositorio (alineada con `Process-AdUserQueue.ps1` y la resolución por defecto de rutas en el backend salvo que defina overrides en `.env`):

| Carpeta | Rol |
|---------|-----|
| `pending` | Cola de entrada: aquí el backend escribe `pendiente-*.json`. **Debe existir** antes de usar el flujo. `AD_QUEUE_UNC` debe apuntar a esta carpeta (ej. `\\servidor\scripts\pending`). |
| `procesados` | JSON por cédula tras alta en AD; el backend la usa para prechequeos. Por defecto: hermana de `pending` (mismo padre que `...\pending`). |
| `resultados` | `resultado-{requestId}.json` para la UI/API. Por defecto: hermana de `pending`. Si usa ruta antigua `pending\resultados`, defina `AD_QUEUE_RESULTS_UNC`. |
| `error` | JSON fallidos movidos por el worker. |

El script del servidor puede crear `procesados`, `resultados` y `error` si no existen; aun así conviene **crearlas y asignar permisos** de antemano (lectura/escritura para la cuenta de Node y la de la tarea programada), coherente con **§3.3.2** y **§7.1**.

Si en `backend/.env` define **`AD_QUEUE_RESULTS_UNC`** o **`AD_QUEUE_PROCESSED_UNC`**, esas rutas deben existir, ser accesibles por SMB y coincidir con donde el worker escribe; no asuma el layout por defecto junto a `pending`.

**Ejemplo de árbol** (UNC `\\servidor\scripts`):

```text
\\servidor\scripts\
├── pending\      ← AD_QUEUE_UNC
├── procesados\
├── resultados\
└── error\
```

### Servidor donde corre el worker AD

Reserve una carpeta local para el script (p. ej. `C:\scripts\`) y copie allí `Process-AdUserQueue.ps1`; el parámetro `-QueuePath` debe ser la carpeta `pending` (UNC o local), misma lógica que **§7**. La estructura de las cuatro carpetas puede estar solo en UNC compartida por el API y el worker, o replicada localmente si su arquitectura lo exige; lo crítico es que `AD_QUEUE_UNC` y la tarea programada apunten a la misma cola `pending`.

## 6.1 Backend (API)

1. Configurar variables de entorno del proceso (`AZURE_*`, `AD_QUEUE_*`, `CORS_ORIGIN`, `PORT`, etc.).
2. Instalar dependencias:

```bash
cd backend
npm install
```

3. Iniciar servicio:

```bash
npm start
```

4. Exponer endpoint de salud para monitoreo:
- `GET /health` debe responder `200`.

Se recomienda ejecutar con gestor de procesos/servicio del sistema operativo para reinicio automático.

## 6.2 Frontend (build estático)

1. Configurar variables `VITE_*` antes del build.
2. Generar artefacto:

```bash
cd frontend
npm ci
npm run build
```

3. Publicar carpeta `frontend/dist` en hosting estático (IIS, Nginx o plataforma equivalente).

Importante:
- El frontend no usa el proxy de Vite en producción.
- `VITE_API_BASE_URL` debe apuntar al API publicado (ruta pública real).

## 7. Configuración del Worker AD (PowerShell)

Script de referencia:
- `docs/server-scripts/Process-AdUserQueue.ps1`

Guía operativa:
- `docs/server-scripts/README.md`

## 7.1 Requisitos del worker

- Módulo ActiveDirectory disponible.
- Permisos de la cuenta de ejecución para crear usuarios en la OU.
- Acceso de lectura/escritura a la ruta de cola UNC.

## 7.2 Configuración recomendada (modo continuo)

Use el **Programador de tareas** (`taskschd.msc`). Cree una **tarea** (no «tarea básica»).

**Paso previo**

1. Copie `Process-AdUserQueue.ps1` en el servidor, por ejemplo en `C:\scripts\`.

### Pestaña General

- **Nombre:** `Aris-AD-Queue-Worker` (o el nombre acordado en su organización).
- Active **Ejecutar tanto si el usuario inició sesión como si no**, para que el worker siga activo sin depender de una sesión interactiva.
- Active **Ejecutar con los privilegios más altos**.
- **Al ejecutar la tarea usar la cuenta:** usuario de servicio del dominio con permisos para crear usuarios en la OU destino y lectura/escritura sobre la UNC de la cola (véase §3.3.3). Tras cambiar la cuenta, Windows puede solicitar la contraseña al guardar.

### Pestaña Desencadenadores

1. Pulse **Nuevo**.
2. En **Comenzar la tarea**, elija **Al iniciar el sistema**.
3. Asegúrese de que el desencadenador quede **Habilitado** (casilla activa).
4. Pulse **Aceptar**.

### Pestaña Acciones

1. Pulse **Nuevo**.
2. **Acción:** **Iniciar un programa**.
3. **Programa o script:** `powershell.exe` (equivalente a `PowerShell.exe`).
4. **Agregar argumentos (opcional):** una sola línea. El script en el repositorio es `Process-AdUserQueue.ps1`; la ruta en `-File` debe coincidir con el nombre real del archivo en su servidor (si lo renombró, p. ej. a `crear_usuario.ps1`, ajuste solo esa parte).

Parámetros correctos (respete mayúsculas en los nombres de parámetro): `-Continuous`, `-IdleSleepMilliseconds`, `-QueuePath`.

En la siguiente plantilla, sustituya `SERVIDOR`, dominio (`DC=`...) y OU por los valores de su AD:

```text
-NoProfile -ExecutionPolicy Bypass -File "C:\scripts\Process-AdUserQueue.ps1" -Continuous -IdleSleepMilliseconds 300 -QueuePath "\\SERVIDOR\scripts\pending" -OrganizationalUnit "OU=Office365Sync,OU=Usuarios,DC=dominio,DC=local" -DefaultCompany "Mi Empresa"
```

El valor de **-OrganizationalUnit** debe ser el **DN completo** y real en Active Directory (incluida la cadena correcta de `DC=` para su bosque).

### Pestaña Condiciones

- Si el equipo aplica políticas de energía que suspenden ejecución, desmarque restricciones que impidan lanzar la tarea (según política corporativa).

### Pestaña Configuración

- **Si la tarea falla, reiniciar cada:** 1 minuto (ajuste si lo exige soporte).
- **Intentar reiniciar hasta:** 3 veces (o el número acordado).
- **Si la tarea ya se está ejecutando, la siguiente regla aplica:** **No iniciar una nueva instancia** (evita dos bucles sobre la misma cola).

## 7.3 Cómo validar que la tarea quedó bien

1. Ejecute la tarea manualmente desde Task Scheduler (**Ejecutar**).
2. Desde la app, cree un administrativo de prueba.
3. Resultado esperado:
   - Aparece `pendiente-*.json` en la cola y luego desaparece al procesarse.
   - Se crea archivo de resultado/procesado según configuración.
4. Si falla:
   - Revise subcarpeta `error` y el `.log` generado.
   - Revise permisos de cuenta de servicio en OU y UNC.
   - Revise que no haya otra instancia del script corriendo.

## 8. Pruebas de Humo (Smoke Test)

Ejecute estas pruebas en orden. Cada paso indica objetivo, resultado esperado y accion si falla.

### 8.1 Pruebas minimas obligatorias

**Paso 1 - Salud del backend**
- Objetivo: confirmar que la API esta arriba.
- Prueba: `GET /health`
- Esperado: HTTP `200` con estado `ok`.
- Si falla: revisar proceso `npm start`, puerto `PORT`, logs del backend.

**Paso 2 - Conexion de cola AD (si aplica)**
- Objetivo: validar escritura en `AD_QUEUE_UNC`.
- Prueba: `GET /api/users/administrative/queue-connection-test`
- Esperado: HTTP `200` y `ok: true`.
- Si falla: revisar ruta UNC, permisos SMB, puerto 445, credenciales de la cuenta del backend.

**Paso 3 - Frontend disponible**
- Objetivo: confirmar que el sitio carga en URL pública.
- Prueba: abrir URL del frontend en navegador.
- Esperado: pantalla de login/carga sin errores de red.
- Si falla: revisar publicación de `dist` y configuración de hosting estático.

**Paso 4 - Login MSAL**
- Objetivo: validar integracion con Entra ID.
- Prueba: iniciar sesión con usuario autorizado.
- Esperado: acceso exitoso al aplicativo.
- Si falla: revisar `VITE_AZURE_TENANT_ID`, `VITE_AZURE_CLIENT_ID`, redirect URI de la app en Entra.

### 8.2 Pruebas recomendadas

**Paso 5 - Validacion de API (sin efectos)**
- Objetivo: confirmar validaciones de entrada.
- Prueba: `POST /api/users` con `{}` y `POST /api/users/operational` con `{}`.
- Esperado: HTTP `400` en ambos casos.
- Si falla: revisar rutas publicadas y versión de backend desplegada.

**Paso 6 - Flujo administrativo extremo a extremo**
- Objetivo: confirmar integracion backend -> cola -> worker AD.
- Prueba: crear un administrativo real de prueba.
- Esperado: respuesta `202`, procesamiento del JSON en cola y resultado en AD.
- Si falla: revisar tarea programada, carpeta `error`, permisos sobre OU.

## 9. Troubleshooting Operativo

## 9.1 Error 503 por configuración administrativa

Revisar:
- `AD_QUEUE_UNC` y `AD_QUEUE_EMAIL_DOMAIN` definidos.
- Conectividad SMB al recurso compartido.
- Permisos de la cuenta del backend sobre la carpeta UNC.

## 9.2 Fallos en Graph

Revisar:
- `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`.
- Permisos de aplicacion consentidos por administrador.
- Vigencia del secret.

## 9.3 Cola no procesada en AD

Revisar:
- Tarea programada activa.
- Script en modo `-Continuous`.
- Permisos de cuenta de tarea sobre OU.
- Archivos movidos a carpeta `error` y logs asociados.

## 9.4 Problemas de CORS en producción

Definir `CORS_ORIGIN` con el origen publico del frontend.

## 9.5 Variables frontend no aplican tras cambio

Recordar:
- Cambios en `VITE_*` requieren nuevo `npm run build` y nueva publicación de `dist`.

