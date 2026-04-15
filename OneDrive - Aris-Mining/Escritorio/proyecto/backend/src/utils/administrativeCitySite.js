/**
 * Sedes administrativas: etiquetas de UI/Excel → bucket para OU; nombre legible para atributo City en AD.
 * OU de creación: OU hoja + contenedor (AD_QUEUE_OU_DN). Por defecto OU=Medellin|Marmato|Segovia; con AD_QUEUE_OU_LEAF_PREFIX
 * (p. ej. Usuarios-Office365Sync) → OU=Usuarios-Office365Sync-Medellin,contenedor. El JSON `city` = texto legible en AD (City).
 */

/** Valores permitidos en API/cola tras normalizar (también aceptados como entrada directa). */
export const ADMINISTRATIVE_CITY_SITE_BUCKETS = Object.freeze(['Medellin', 'Marmato', 'Segovia']);

/** Etiquetas exactas permitidas en formulario y Excel (seis opciones). */
export const ADMINISTRATIVE_CITY_DISPLAY_LABELS = Object.freeze([
  'Segovia',
  'Medellín',
  'Bogotá',
  'PSN',
  'Marmato',
  'Lower Mine',
]);

/**
 * Clave estable para comparar ciudad/sede (Excel: minúsculas, sin tilde, espacios raros, NBSP).
 * @param {unknown} input
 * @returns {string} solo [a-z0-9] o cadena vacía
 */
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

/**
 * @param {unknown} input - etiqueta de sede o bucket canónico
 * @returns {'Medellin' | 'Marmato' | 'Segovia' | null}
 */
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

/**
 * Valor para el atributo City en AD y campo `city` del JSON de cola: nombre legible (Medellín, Bogotá, PSN, …).
 * @param {unknown} raw
 * @returns {string}
 */
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

/**
 * DN de OU hoja para New-ADUser -Path.
 * @param {'Medellin' | 'Marmato' | 'Segovia'} siteBucket
 * @param {string} parentDn - contenedor LDAP (valor de AD_QUEUE_OU_DN), sin coma inicial
 */
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
