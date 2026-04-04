# Sistema de creación de usuarios — Microsoft 365 y Active Directory

Sistema para crear **usuarios operativos en Microsoft 365** (Microsoft Graph) y **usuarios administrativos en Active Directory local** (PowerShell remoto con `Invoke-Command` / `New-ADUser`), con front-end en React+TypeScript y backend en Node.js/Express (**el backend para administrativos debe ejecutarse en Windows**).

## Estructura del Proyecto

```
proyecto/
├── frontend/          # Aplicación React + TypeScript
├── backend/           # API Node.js + Express con integración Microsoft Graph
└── README.md          # Este archivo
```

## Características principales

- **Operativos (Microsoft 365)**: creación vía Microsoft Graph; sin licencias por defecto; contraseña inicial con cambio obligatorio en primer inicio.
- **Administrativos (Active Directory local)**: creación vía **scripts PowerShell** (`Create-AdAdministrativeUser.ps1`) lanzados desde Node; `Invoke-Command` contra `AD_PS_COMPUTER_NAME`; grupos AD y pasos opcionales EXO/MSOL/replicación según `.env`.
- **Validación de unicidad**: Graph para M365; para AD, script `Select-FirstAvailableAdSam.ps1` con `Get-ADUser` remoto (si falla o no es Windows, se usa el primer candidato generado en servidor).
- **Creación administrativa asíncrona**: `POST /api/users/administrative` responde **202** con `jobId`; el cliente consulta `GET /api/users/administrative/jobs/:jobId` hasta `completed` o `failed` (el flujo puede tardar muchos minutos).
- **Front-end**: pestañas **Operativo (Microsoft 365)** y **Administrativo (Active Directory)**; carga masiva Excel solo para operativos.

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
   - **Windows** donde corre Node, con **WinRM** hacia el equipo definido en `AD_PS_COMPUTER_NAME` (donde se ejecuta `New-ADUser`).
   - Módulos **ActiveDirectory** en el destino remoto; opcionalmente **ExchangeOnlineManagement** y **MSOnline** si `AD_PS_SKIP_CLOUD_STEPS=false`.
   - Variables **`AD_PS_*`** según `backend/.env.example` (OU, dominio de correo, grupos, credenciales EXO si aplica).

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

Editar `.env` con tus credenciales. Incluye Azure AD **y**, si usas administrativos, las variables **`AD_PS_*`** (ver `backend/.env.example`).

```
AZURE_TENANT_ID=tu-tenant-id
AZURE_CLIENT_ID=tu-client-id
AZURE_CLIENT_SECRET=tu-client-secret
PORT=5000
NODE_ENV=development

# Active Directory — administrativos (PowerShell); ver backend/.env.example
AD_PS_COMPUTER_NAME=dc01.corp.local
AD_PS_OU_PATH=OU=Administrativos,DC=corp,DC=local
AD_PS_EMAIL_DOMAIN=empresa.co
AD_PS_COMPANY=MiEmpresa
AD_PS_HOME_DIRECTORY_ROOT=E:\Usr
AD_PS_GROUPS=Grupo1,Grupo2
AD_PS_SKIP_CLOUD_STEPS=true
```

### Frontend

```bash
cd frontend
npm install
```

Crear `frontend/.env` según `frontend/.env.example` (API, Entra ID para el login SPA, y **`VITE_AD_UPN_SUFFIX`** alineado con **`AD_PS_EMAIL_DOMAIN`** del backend, p. ej. `empresa.co`, para la vista previa de UPN en la pestaña administrativa).

**`VITE_API_BASE_URL` (importante):** las rutas del servidor son `/api/users/...`. Usa una de estas opciones:

- Llamada directa al backend: `VITE_API_BASE_URL=http://localhost:5000/api`
- Solo proxy de Vite (app en `http://localhost:3000`): `VITE_API_BASE_URL=/api`

Si pones solo `http://localhost:5000` sin `/api`, el cliente intenta corregirlo automáticamente añadiendo `/api`; aun así se recomienda dejar la URL explícita en `.env` para evitar confusiones.

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

1. Mismos campos del formulario (pestaña **Administrativo**), más **cédula / ID** y **ciudad** opcionales.
2. El backend genera candidatos de `sAMAccountName` (máx. 20 caracteres) y elige el primero libre en AD vía PowerShell remoto cuando es posible.
3. `POST /administrative` encola un trabajo que ejecuta `Create-AdAdministrativeUser.ps1` (usuario habilitado, contraseña generada, `HomeDrive` Z:, grupos de `AD_PS_GROUPS`, etc.). El estado del trabajo se guarda **en memoria** (no usar varias instancias del servidor sin un almacén compartido).

### Troubleshooting PowerShell / AD (administrativos)

| Síntoma | Qué revisar |
| --- | --- |
| 503 Configuración incompleta | Variables `AD_PS_*` obligatorias en `.env` (ver `.env.example`). |
| WinRM / Kerberos `0x80090311` / «dominio no disponible» | PC conectado a la red del dominio o VPN; usar **FQDN** del DC en `AD_PS_COMPUTER_NAME`; o bien sesión con usuario de dominio. |
| WinRM con **IP** («TrustedHosts», credenciales) | En el cliente: `Set-Item WSMan:\localhost\Client\TrustedHosts -Value 'IP_o_host' -Concatenate` (PowerShell como admin). En `.env`: `AD_PS_WINRM_USER` y `AD_PS_WINRM_PASSWORD` (cuenta de dominio). |
| WinRM / acceso denegado | Firewall del DC (5985/5986); permisos de la cuenta en AD; que el servicio WinRM esté activo en el destino. |
| Módulos no encontrados | RSAT/AD PowerShell en el servidor remoto; `ExchangeOnlineManagement` / `MSOnline` si no usáis `AD_PS_SKIP_CLOUD_STEPS=true`. |
| Trabajo `failed` | Revisar `log` en la respuesta del job en modo `development`; salida stderr de PowerShell. |

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

### GET /api/users/administrative/next-username

Misma query que `/api/users/next-username`: `givenName`, `surname1`, `surname2` (opcional). Devuelve el siguiente `sAMAccountName` disponible en AD.

### POST /api/users/administrative

Encola la creación de un usuario administrativo en Active Directory (PowerShell).

**Request:** igual que `POST /api/users/operational`, con opcionales `employeeId` (cédula) y `city`.

**Response (202 Accepted):**
```json
{
  "jobId": "uuid",
  "statusUrl": "/api/users/administrative/jobs/uuid",
  "message": "Creación encolada..."
}
```

### GET /api/users/administrative/jobs/:jobId

Estado del trabajo: `pending` | `running` | `completed` | `failed`. Si `completed`, `result` incluye `sAMAccountName`, `userPrincipalName`, `displayName`, `email`.

**Nota:** los trabajos se almacenan en memoria; al reiniciar el servidor se pierden.

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
- Scripts PowerShell en `backend/scripts/` (creación y selección de SamAccountName en AD remoto)

## Licencia

ISC
