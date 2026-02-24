# Backend - Creación de Usuarios Operativos Microsoft 365

Backend API en Node.js/Express que integra con Microsoft 365 (Microsoft Graph) para crear usuarios operativos.

## Requisitos Previos

1. **Registro de aplicación en Azure AD**
   - Crear una aplicación en Azure Portal
   - Configurar permisos de aplicación: `User.ReadWrite.All`
   - Generar un Client Secret
   - Obtener Tenant ID, Client ID y Client Secret

2. **Node.js**
   - Versión 18 o superior

## Instalación

```bash
npm install
```

## Configuración

1. Copiar el archivo `.env.example` a `.env`:
```bash
cp .env.example .env
```

2. Configurar las variables de entorno en `.env`:
```
AZURE_TENANT_ID=tu-tenant-id
AZURE_CLIENT_ID=tu-client-id
AZURE_CLIENT_SECRET=tu-client-secret
PORT=5000
NODE_ENV=development
```

## Ejecución

### Desarrollo
```bash
npm run dev
```

### Producción
```bash
npm start
```

El servidor se ejecutará en `http://localhost:5000` (o el puerto especificado en PORT).

## Endpoints

### POST /api/users/operational

Crea un nuevo usuario operativo en Microsoft 365.

**Request Body:**
```json
{
  "givenName": "Juan",
  "surname1": "Pérez",
  "surname2": "García", // Opcional
  "jobTitle": "Desarrollador",
  "department": "TI"
}
```

**Response (201 Created):**
```json
{
  "id": "user-id-from-m365",
  "userPrincipalName": "juan.perez@aris-mining-co",
  "displayName": "Juan Pérez",
  "email": "juan.perez@aris-mining-co",
  "message": "Usuario creado exitosamente en Microsoft 365"
}
```

## Permisos Requeridos en Azure AD

La aplicación debe tener los siguientes permisos de aplicación (no delegados):

- `User.ReadWrite.All` - Permite crear y modificar usuarios

## Seguridad

- Las credenciales de Azure AD se gestionan mediante variables de entorno
- El endpoint puede protegerse adicionalmente con autenticación JWT o Azure AD si es necesario
- La contraseña inicial es fija (`Aris1234*`) y el usuario debe cambiarla en el primer inicio de sesión
