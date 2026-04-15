# Sistema de creación de usuarios — Microsoft 365 y Active Directory

Sistema para crear **usuarios operativos en Microsoft 365** (Microsoft Graph) y **usuarios administrativos en Active Directory local** mediante una **cola de archivos JSON** en una carpeta compartida (SMB/UNC) escrita por Node; un **script PowerShell** en el servidor (Programador de tareas) ejecuta `New-ADUser` y elimina cada solicitud procesada. Front-end en React+TypeScript y backend en Node.js/Express (**el PC que ejecuta Node necesita permiso de escritura en la UNC**; suele ser Windows en red corporativa).

## Estructura del Proyecto

```
proyecto/
├── frontend/          # Aplicación React + TypeScript
├── backend/           # API Node.js + Express con integración Microsoft Graph
├── docs/server-scripts/  # Script PowerShell de ejemplo para el servidor (cola AD)
└── README.md          # Este archivo
```

## Características principales

- **Operativos (Microsoft 365)**: creación vía Microsoft Graph; sin licencias por defecto; contraseña inicial con cambio obligatorio en primer inicio.
- **Administrativos (Active Directory local)**: Node escribe **`pendiente-{uuid}.json`** en la ruta **`AD_QUEUE_UNC`**; el script **`docs/server-scripts/Process-AdUserQueue.ps1`** (en el servidor) procesa la cola y crea el usuario en AD; **Azure AD Connect** sincroniza hacia Microsoft 365.
- **Administrativos — cédula / ID**: obligatoria en API y formulario (5–32 caracteres alfanuméricos y guiones). Antes de encolar, el backend consulta **Microsoft Graph** para rechazar **409** si `employeeId` ya existe en el inquilino, y elige **samAccountName/UPN** recorriendo las mismas variantes que en operativos hasta encontrar un correo libre. **`AD_QUEUE_SKIP_GRAPH_PRECHECK=true`** desactiva ese prechequeo (solo pruebas; no recomendado en producción).
- **Validación en AD**: el script en servidor comprueba `samAccountName` y **EmployeeID** duplicados antes de `New-ADUser`. Usuarios solo on‑prem aún no sincronizados pueden no aparecer en Graph hasta que AADC ejecute un ciclo.
- **Nombre de usuario administrativo (LDAP/Graph)**: **`GET /api/users/administrative/next-username`** usa Graph (salvo `AD_QUEUE_SKIP_GRAPH_PRECHECK`) para devolver el primer **mailNickname/UPN** libre coherente con la lógica de operativos.
- **Creación administrativa encolada**: **`POST /api/users`** (y el alias **`POST /api/users/administrative`**) responden **202** con `requestId`, ruta del archivo y datos propuestos; no hay polling de trabajos en el backend.
- **Front-end**: pestañas **Operativo (Microsoft 365)** y **Administrativo (Active Directory)**; carga masiva Excel para operativos (Graph) y para administrativos (cola AD).

## Requisitos Previos

### Para el Backend

1. **Registro de aplicación en Azure AD**
   - Crear una aplicación en [Azure Portal](https://portal.azure.com)
   - Configurar permisos de aplicación: `User.ReadWrite.All`
   - Generar un Client Secret
   - Obtener:
     - Tenant ID
     - Client ID (Application ID)
     - Client Secret

2. **Node.js**
   - Versión 18 o superior

3. **Active Directory (solo para usuarios administrativos)**
   - **Recurso compartido** accesible desde el PC donde corre Node (`AD_QUEUE_UNC`), con ACL de escritura para la cuenta que ejecuta el proceso Node.
   - En el **servidor** (o equipo con permisos en AD): módulo **ActiveDirectory** para PowerShell y tarea programada que ejecute `Process-AdUserQueue.ps1` (ver `docs/server-scripts/README.md`).
   - Variables **`AD_QUEUE_*`** según `backend/.env.example`.

### Para el Frontend

- Node.js 18 o superior
- Navegador moderno (Chrome, Firefox, Edge, Safari)

## Instalación

### Backend

```bash
cd backend
npm install
```

Copiar `.env.example` a `.env` y configurar las variables:

```bash
cp .env.example .env
```

Editar `.env` con tus credenciales. Incluye Azure AD **y**, si usas administrativos, las variables **`AD_QUEUE_*`** (ver `backend/.env.example`).

```
AZURE_TENANT_ID=tu-tenant-id
AZURE_CLIENT_ID=tu-client-id
AZURE_CLIENT_SECRET=tu-client-secret
PORT=5000
NODE_ENV=development

# Active Directory — cola SMB; ver backend/.env.example
AD_QUEUE_UNC=\\10.10.11.9\scripts\pending
AD_QUEUE_EMAIL_DOMAIN=empresa.co
# Opcional: atributo Company en AD (campo empresa en el JSON)
# AD_QUEUE_COMPANY=Mi Empresa
```

### Frontend

```bash
cd frontend
npm install
```

Crear `frontend/.env` según `frontend/.env.example` (API y Entra ID para el login SPA). Opcionalmente defina **`VITE_PLANTILLA_OPERARIOS_URL`** y **`VITE_PLANTILLA_ADMINISTRATIVOS_URL`** como URL **https** absolutas (p. ej. enlace de descarga en SharePoint) para que el botón «Descargar plantilla» no use solo los `.xlsx` de `frontend/public/` (útil si la plantilla corporativa lleva estilos o validaciones).

**`VITE_API_BASE_URL` (importante):** las rutas del servidor son `/api/users/...`. Usa una de estas opciones:

- Llamada directa al backend: `VITE_API_BASE_URL=http://localhost:5000/api`
- Solo proxy de Vite (app en `http://localhost:3000`): `VITE_API_BASE_URL=/api`

Si pones solo `http://localhost:5000` sin `/api`, el cliente intenta corregirlo automáticamente añadiendo `/api`; aun así se recomienda dejar la URL explícita en `.env` para evitar confusiones.

### Plantillas Excel (estilos y dónde guardarlas)

- El script **`backend/scripts/generatePlantillaAdministrativos.mjs`** vuelve a escribir `plantilla-administrativos.xlsx` **sin formato rico de Excel**; no lo ejecute sobre una plantilla ya maquetada en la misma ruta.
- Si el repo está en **OneDrive**, al editar el `.xlsx` en Excel y guardar en la carpeta del proyecto pueden aparecer **conflictos de sincronización** o sensación de que «al reiniciar» se pierden estilos; conviene plantilla definitiva en **SharePoint** (y `VITE_PLANTILLA_*_URL`) o carpeta **fuera** de OneDrive y luego copiar al repo.
- En la raíz del repo, **`.gitattributes`** marca `*.xlsx` como **binary** para que Git no toque finales de línea y no dañe el archivo.

#### Qué debe hacer el equipo (plantilla fija con diseño en SharePoint)

1. Crear o subir el **Excel maquetado** (colores, validaciones, etc.) a una **biblioteca de documentos** en SharePoint (o sitio de Teams).
2. Generar un **vínculo de acceso** al archivo (idealmente solo personas de la organización, según política).
3. Copiar la URL completa; debe empezar por **`https://`**.
4. En **`frontend/.env`** (y en las variables de entorno del **build de producción**), definir una o ambas:
   - `VITE_PLANTILLA_OPERARIOS_URL=https://.../plantilla-operarios.xlsx`
   - `VITE_PLANTILLA_ADMINISTRATIVOS_URL=https://.../plantilla-administrativos.xlsx`
5. **Reiniciar** el servidor de desarrollo (`npm run dev` en `frontend`) o **volver a construir y publicar** el sitio para que Vite inyecte las variables.
6. Comprobar el botón **Descargar plantilla** en la app: debe abrir el enlace (nueva pestaña). Los usuarios deben usar en Excel (web o aplicación) **Archivo → Guardar como → Descargar una copia** (o **Crear una copia** / **Descargar**, según la pantalla), trabajar en esa copia local y subirla con **Elegir archivo**; así no sobrescriben la plantilla maestra en SharePoint. La app **no modifica** el archivo en la nube.

Si no se definen esas variables, la app sigue usando los archivos por defecto en **`frontend/public/plantilla-*.xlsx`**.

## Ejecución

### Desarrollo

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
```

El backend se ejecutará en `http://localhost:5000`

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

El frontend se ejecutará en `http://localhost:3000`

### Producción

**Backend:**
```bash
cd backend
npm start
```

**Frontend:**
```bash
cd frontend
npm run build
# Servir los archivos en dist/ con un servidor web estático
```

## Flujo de creación de usuario

### Operativo (Microsoft 365)

1. El usuario completa el formulario con:
   - Nombre (obligatorio)
   - Primer Apellido (obligatorio)
   - Segundo Apellido (opcional)
   - Puesto (obligatorio)
   - Departamento (obligatorio)

2. El sistema genera automáticamente:
   - **Display Name**: `Nombre + Primer Apellido`
   - **Correo corporativo**: `nombre.apellido@aris-mining-co`

3. Al enviar el formulario:
   - El backend valida la unicidad del correo en Microsoft 365
   - Si existe `nombre.apellido1`, intenta con `nombre.apellido2`
   - Si también existe, añade un sufijo numérico incremental

4. El usuario se crea en Microsoft 365 con:
   - Contraseña inicial: `Aris1234*`
   - Cambio de contraseña obligatorio en primer inicio
   - Sin licencias asignadas
   - Puesto y departamento configurados

### Administrativo (Active Directory)

1. Mismos campos del formulario (pestaña **Administrativo**), **cédula / ID obligatoria** (5–32 caracteres) y **ciudad** opcional.
2. El backend valida contra **Microsoft Graph** que no exista otro usuario con el mismo `employeeId` y elige un **UPN/sAMAccountName** libre con la misma secuencia de candidatos que en operativos (salvo `AD_QUEUE_SKIP_GRAPH_PRECHECK`).
3. Se escribe **`pendiente-{uuid}.json`** en **`AD_QUEUE_UNC`** con `employeeId`, `samAccountName`, `userPrincipalName`, etc.
4. El script **`Process-AdUserQueue.ps1`** comprueba de nuevo **EmployeeID** y **SamAccountName** en AD, crea con `New-ADUser`, borra el JSON o mueve a **`error\`**. **Azure AD Connect** sincroniza hacia Microsoft 365.

### Troubleshooting cola SMB / AD (administrativos)

| Síntoma | Qué revisar |
| --- | --- |
| 503 Configuración incompleta | Variables `AD_QUEUE_UNC` y `AD_QUEUE_EMAIL_DOMAIN` en `.env` (ver `.env.example`). |
| 503 Prechequeo Graph | Credenciales `AZURE_*` faltantes o error al llamar a Graph; o use `AD_QUEUE_SKIP_GRAPH_PRECHECK` solo en pruebas. |
| 409 Cédula duplicada | Ya existe un usuario en el inquilino M365 con el mismo `employeeId`. |
| 422 Sin UPN disponible | Agotadas las variantes de nombre de usuario en Graph; revisar manualmente. |
| 500 / error al escribir la cola | Que la UNC exista; que la cuenta de Windows que ejecuta Node tenga **permiso de escritura** en el recurso; firewall SMB (445) entre PC y servidor de archivos. |
| No se crean usuarios en AD | Que la **tarea programada** en el servidor esté activa; permisos de la cuenta de la tarea en la OU; logs en `error\` junto al JSON fallido (`docs/server-scripts/README.md`). |
| `samAccountName ya existe` / EmployeeID duplicado | Colisión en AD; el script mueve el archivo a `error\`. |

Tras modificar `.env`, **reinicie el backend**.

### Troubleshooting Microsoft Graph (usuarios operativos)

Los errores de creación o consulta en Microsoft 365 se registran con prefijo `[GRAPH]` en la consola (una línea con código HTTP y mensaje). Revise `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, permisos **User.ReadWrite.All** con consentimiento de administrador y que el secreto no haya expirado.

## API Endpoints

### POST /api/users/operational

Crea un nuevo usuario operativo en Microsoft 365.

**Request:**
```json
{
  "givenName": "Juan",
  "surname1": "Pérez",
  "surname2": "García",
  "jobTitle": "Desarrollador",
  "department": "TI"
}
```

**Response (201):**
```json
{
  "id": "user-id-from-m365",
  "userPrincipalName": "juan.perez@aris-mining-co",
  "displayName": "Juan Pérez",
  "email": "juan.perez@aris-mining-co",
  "message": "Usuario creado exitosamente en Microsoft 365"
}
```

### POST /api/users

Encola la creación corporativa en Active Directory escribiendo **`pendiente-{requestId}.json`** en **`AD_QUEUE_UNC`**.

**Request:** igual que `POST /api/users/operational`, con **`employeeId` (cédula / ID) obligatorio** y `city` opcional.

**Response (409):** si la cédula ya existe en Microsoft Graph (`employeeId` duplicado).

**Response (202 Accepted):**
```json
{
  "requestId": "uuid",
  "message": "Solicitud encolada...",
  "queuePath": "\\\\servidor\\share\\pending\\pendiente-uuid.json",
  "proposedUserName": "juan.perez",
  "userPrincipalName": "juan.perez@empresa.co",
  "displayName": "Juan Pérez"
}
```

### POST /api/users/administrative

Mismo cuerpo y respuesta que **`POST /api/users`** (compatibilidad con clientes existentes).

### GET /api/users/administrative/next-username

Misma query que `/api/users/next-username`: `givenName`, `surname1`, `surname2` (opcional). Con prechequeo Graph activo, devuelve el primer **sAMAccountName/UPN** libre en el inquilino (misma lógica que operativos). Con `AD_QUEUE_SKIP_GRAPH_PRECHECK`, solo el primer candidato teórico sin consultar Graph.

### GET /api/users/administrative/queue-connection-test

Comprueba que el proceso Node pueda **escribir y borrar** un archivo temporal en **`AD_QUEUE_UNC`** (no exige `AD_QUEUE_EMAIL_DOMAIN`). Respuesta **200** con cuerpo JSON: `ok` (boolean), `message`, y opcionalmente `uncPath` y `code` si falló. Útil para diagnosticar sesión SMB y permisos antes de encolar usuarios; el front-end incluye un botón “Probar conexión” en la pestaña administrativa.

### POST /api/users/administrative/bulk

Carga masiva de usuarios administrativos con el mismo patrón Excel que operativos (**`multipart/form-data`**, campo **`file`**, `.xlsx` / `.xls`).

**Plantilla:** el backend **detecta la fila de encabezados** entre las primeras filas (con o sin fila de título arriba) y acepta sinónimos (`Documento` → cédula, `Sede` → ciudad, CP/ZIP → código postal, etc.). Los nombres de columna pueden llevar espacios o tildes. Columnas:

| Columna | Obligatoria | Notas |
| --- | --- | --- |
| `PrimerNombre`, `SegundoNombre`, `PrimerApellido`, `SegundoApellido` | Sí (segundo nombre/apellido pueden ir vacíos según reglas del formulario) | Misma normalización que el alta individual |
| `Puesto`, `Departamento` | Sí | |
| `Cedula` o `Cédula` | Sí | Se mapea a `employeeId`; no puede repetirse dentro del mismo archivo |
| `Ciudad` / `Sede` | Sí | Sede administrativa del listado; sinónimos en el parser (ver backend) |
| `Codigo postal` | Sí | Solo dígitos (reglas alineadas al formulario) |

Por cada fila válida se aplica la misma lógica que **`POST /api/users/administrative`**: validación, prechequeo en **Microsoft Graph** (salvo `AD_QUEUE_SKIP_GRAPH_PRECHECK`) y escritura de **`pendiente-{requestId}.json`** en **`AD_QUEUE_UNC`**. Las filas con error aparecen en `results` sin encolar.

**Response (201):** siempre que el archivo se haya procesado, aunque haya filas con error:

```json
{
  "message": "…",
  "results": [
    {
      "row": 3,
      "status": "success",
      "requestId": "uuid",
      "userPrincipalName": "juan.perez@empresa.co",
      "displayName": "Juan Pérez",
      "proposedUserName": "juan.perez"
    },
    { "row": 4, "status": "error", "message": "…" }
  ]
}
```

## Configuración de Azure AD

### Permisos Requeridos

La aplicación debe tener los siguientes permisos de **aplicación** (no delegados):

- `User.ReadWrite.All` - Permite crear y modificar usuarios

### Pasos para Configurar

1. Ir a [Azure Portal](https://portal.azure.com)
2. Azure Active Directory → App registrations
3. Crear nueva aplicación o seleccionar existente
4. API permissions → Add a permission → Microsoft Graph → Application permissions
5. Seleccionar `User.ReadWrite.All` → Add permissions
6. Grant admin consent (requerido para permisos de aplicación)
7. Certificates & secrets → New client secret
8. Copiar el valor del secret (solo se muestra una vez)
9. Copiar Application (client) ID y Directory (tenant) ID

## Seguridad

- Las credenciales de Azure AD se gestionan mediante variables de entorno
- La contraseña inicial es fija y el usuario debe cambiarla en el primer inicio
- Los usuarios se crean sin licencias por defecto
- El endpoint del backend puede protegerse adicionalmente con autenticación si es necesario

## Tecnologías Utilizadas

### Frontend
- React 18
- TypeScript
- Vite
- Axios

### Backend
- Node.js
- Express
- @microsoft/microsoft-graph-client
- @azure/identity
- Cola SMB (`AD_QUEUE_UNC`) y script de ejemplo en `docs/server-scripts/` para el servidor

## Licencia

ISC
