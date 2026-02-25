# Sistema de Creación de Usuarios Operativos - Microsoft 365

Sistema completo para la creación de usuarios operativos integrado con Microsoft 365, compuesto por un front-end en React+TypeScript y un backend en Node.js/Express.

## Estructura del Proyecto

```
proyecto/
├── frontend/          # Aplicación React + TypeScript
├── backend/           # API Node.js + Express con integración Microsoft Graph
└── README.md          # Este archivo
```

## Características Principales

- **Front-end React+TypeScript**: Interfaz web moderna para crear usuarios operativos
- **Backend Node.js/Express**: API REST que integra con Microsoft 365 mediante Microsoft Graph
- **Validación de unicidad**: El sistema verifica automáticamente si un usuario ya existe y genera alternativas
- **Generación automática de nombres**: Display name y correo corporativo generados automáticamente
- **Políticas de seguridad**: Contraseña inicial predefinida con cambio obligatorio en primer inicio
- **Sin licencias por defecto**: Los usuarios se crean sin asignación de licencias

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

Editar `.env` con tus credenciales de Azure AD:

```
AZURE_TENANT_ID=tu-tenant-id
AZURE_CLIENT_ID=tu-client-id
AZURE_CLIENT_SECRET=tu-client-secret
PORT=5000
NODE_ENV=development
```

### Frontend

```bash
cd frontend
npm install
```

Opcionalmente, crear un archivo `.env` si necesitas cambiar la URL del API:

```
VITE_API_BASE_URL=http://localhost:5000
```

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

## Flujo de Creación de Usuario

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

## Licencia

ISC
