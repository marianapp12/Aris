/**
 * Logo corporativo desde `public/branding/`.
 * Sustituir `logo.svg` en esa carpeta o cambiar BRAND_LOGO_PATH (ver public/branding/README.md).
 */
export const BRAND_LOGO_PATH = '/branding/logo.svg';

type BrandLogoProps = {
  className?: string;
  variant?: 'default' | 'header';
};

export function BrandLogo({ className, variant = 'default' }: BrandLogoProps) {
  return (
    <img
      className={className}
      src={BRAND_LOGO_PATH}
      alt="Aris Mining"
      {...(variant === 'header'
        ? { height: 40, style: { width: 'auto', maxWidth: 200, objectFit: 'contain' as const } }
        : { height: 48, style: { width: 'auto', maxWidth: 260, objectFit: 'contain' as const } })}
    />
  );
}
