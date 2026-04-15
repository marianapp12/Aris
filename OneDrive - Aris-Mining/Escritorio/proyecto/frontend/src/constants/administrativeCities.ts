/**
 * Sedes administrativos: `value` = texto guardado en AD (City) y enviado como `city` al API.
 * El backend deriva la OU (Medellin / Marmato / Segovia) a partir de este valor.
 * Alineado con backend/src/utils/administrativeCitySite.js
 */
export const ADMINISTRATIVE_CITY_SELECT_OPTIONS = [
  { label: 'Segovia', value: 'Segovia' },
  { label: 'Medellín', value: 'Medellín' },
  { label: 'Bogotá', value: 'Bogotá' },
  { label: 'PSN', value: 'PSN' },
  { label: 'Marmato', value: 'Marmato' },
  { label: 'Lower Mine', value: 'Lower Mine' },
] as const;

const CITY_VALUES = new Set(
  ADMINISTRATIVE_CITY_SELECT_OPTIONS.map((o) => o.value)
);

export function isAdministrativeCityFormValue(value: string): boolean {
  return CITY_VALUES.has(value.trim() as (typeof ADMINISTRATIVE_CITY_SELECT_OPTIONS)[number]['value']);
}
