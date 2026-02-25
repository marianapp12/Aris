/**
 * Normaliza un nombre para usarlo en la generación de userName
 * Elimina acentos, convierte a minúsculas y reemplaza espacios por puntos
 */
export const normalizeName = (name: string): string => {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Elimina acentos
    .replace(/[^a-z0-9]/g, '') // Elimina caracteres especiales
    .trim();
};

/**
 * Genera el nombre de usuario propuesto basado en nombre y apellido
 */
export const generateUserName = (
  givenName: string,
  surname: string
): string => {
  const normalizedGivenName = normalizeName(givenName);
  const normalizedSurname = normalizeName(surname);
  
  if (!normalizedGivenName || !normalizedSurname) {
    return '';
  }
  
  return `${normalizedGivenName}.${normalizedSurname}`;
};

/**
 * Genera el displayName completo
 */
export const generateDisplayName = (
  givenName: string,
  surname: string
): string => {
  return `${givenName.trim()} ${surname.trim()}`.trim();
};
