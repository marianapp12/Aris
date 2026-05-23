/** UI/Excel → bucket OU (Medellin|Marmato|Segovia); city = City en AD; OU bajo AD_QUEUE_OU_DN (+ prefijo opcional). */

export const ADMINISTRATIVE_CITY_SITE_BUCKETS = Object.freeze(['Medellin', 'Marmato', 'Segovia']);

/** Seis etiquetas válidas en formulario y Excel. */
export const ADMINISTRATIVE_CITY_DISPLAY_LABELS = Object.freeze([
  'Segovia',
  'Medellín',
  'Bogotá',
  'PSN',
  'Marmato',
  'Lower Mine',
]);

/** Clave [a-z0-9] para comparar sede (sin tildes, NBSP, etc.). */
export function administrativeCityNormalizedKey(input) {
  return String(input ?? '')
    .trim()
    .replace(/\u00a0/g, ' ')
    .replace(/\u200b/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Tras {@link administrativeCityNormalizedKey}: medellin, bogota, psn, marmato, segovia, lowermine, … */
const CITY_KEY_TO_BUCKET_AND_DISPLAY = Object.freeze({
  segovia: { bucket: 'Segovia', display: 'Segovia' },
  medellin: { bucket: 'Medellin', display: 'Medellín' },
  bogota: { bucket: 'Marmato', display: 'Bogotá' },
  psn: { bucket: 'Marmato', display: 'PSN' },
  marmato: { bucket: 'Marmato', display: 'Marmato' },
  lowermine: { bucket: 'Segovia', display: 'Lower Mine' },
  overmain: { bucket: 'Segovia', display: 'Lower Mine' },
  overmine: { bucket: 'Segovia', display: 'Lower Mine' },
});

export function mapAdministrativeCityInputToBucket(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  if (ADMINISTRATIVE_CITY_SITE_BUCKETS.includes(raw)) return raw;
  const k = administrativeCityNormalizedKey(input);
  if (!k) return null;
  const hit = CITY_KEY_TO_BUCKET_AND_DISPLAY[k];
  if (hit) return hit.bucket;
  return null;
}

/** Texto legible para City en AD y campo city del JSON de cola. */
export function normalizeAdministrativeCityDisplayForAd(raw) {
  const t = String(raw ?? '').trim();
  if (!t) return '';
  if (ADMINISTRATIVE_CITY_DISPLAY_LABELS.includes(t)) return t;
  const k = administrativeCityNormalizedKey(raw);
  if (!k) return t;
  const hit = CITY_KEY_TO_BUCKET_AND_DISPLAY[k];
  if (hit) return hit.display;
  return t;
}

/** OU hoja para New-ADUser -Path (AD_QUEUE_OU_LEAF_PREFIX opcional). */
export function buildAdministrativeOuDn(siteBucket, parentDn) {
  const parent = String(parentDn ?? '').trim();
  if (!parent) {
    throw new Error('Falta DN de contenedor (AD_QUEUE_OU_DN) para construir la OU por sede.');
  }
  if (!ADMINISTRATIVE_CITY_SITE_BUCKETS.includes(siteBucket)) {
    throw new Error(`Sitio inválido para OU: ${siteBucket}`);
  }
  const prefix = process.env.AD_QUEUE_OU_LEAF_PREFIX?.trim();
  const leaf = prefix ? `${prefix}-${siteBucket}` : siteBucket;
  return `OU=${leaf},${parent}`;
}
