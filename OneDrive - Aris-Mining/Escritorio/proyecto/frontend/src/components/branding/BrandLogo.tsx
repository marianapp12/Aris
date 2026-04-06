/**
 * Logo corporativo desde `public/branding/`.
 * Archivo por defecto: `logo.png` (ver `public/branding/README.md`).
 */
export const BRAND_LOGO_PATH = '/branding/logo.png';

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
      decoding="async"
      {...(variant === 'header'
        ? {
            height: 40,
            style: {
              width: 'auto',
              maxWidth: 220,
              maxHeight: 40,
              objectFit: 'contain' as const,
            },
          }
        : {
            height: 52,
            style: {
              width: 'auto',
              maxWidth: 280,
              maxHeight: 56,
              objectFit: 'contain' as const,
            },
          })}
    />
  );
}
