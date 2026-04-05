# Carpeta de marca (logo)

**Ubicación en el proyecto:** `frontend/public/branding/`

Los archivos de esta carpeta se sirven en la raíz del sitio con la URL **`/branding/nombre-del-archivo`**. Así no dependéis de rutas largas ni del código fuente al cambiar el logo.

## Qué archivo usar

1. **Por defecto** la aplicación carga **`logo.svg`** (incluido como ejemplo; podéis sustituirlo por el logo oficial manteniendo el mismo nombre).
2. Si preferís **PNG**, copiad por ejemplo `logo.png` aquí y editad la constante **`BRAND_LOGO_PATH`** en  
   `frontend/src/components/branding/BrandLogo.tsx`  
   para que apunte a `'/branding/logo.png'`.

## Colores corporativos referencia

- Teal: `#0388A6`
- Gris claro: `#F2F2F2`
- Azul marino: `#172540`
