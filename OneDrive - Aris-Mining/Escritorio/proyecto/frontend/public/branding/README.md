# Carpeta de marca (logo)

**Ubicación en el proyecto:** `frontend/public/branding/`

Los archivos de esta carpeta se sirven en la raíz del sitio con la URL **`/branding/nombre-del-archivo`**. Así no dependéis de rutas largas ni del código fuente al cambiar el logo.

## Qué archivo usar

1. **Por defecto** la aplicación carga **`logo.png`** en esta carpeta (sustituid el archivo por el logo oficial manteniendo el nombre).
2. Para usar **SVG** u otro nombre, cambiad **`BRAND_LOGO_PATH`** en  
   `frontend/src/components/branding/BrandLogo.tsx`  
   (por ejemplo `'/branding/logo.svg'`).

## Colores corporativos referencia (UI)

- Teal principal: `#067996`
- Fondo página: `#E6EDF5`
- Texto navy: `#122A42`
