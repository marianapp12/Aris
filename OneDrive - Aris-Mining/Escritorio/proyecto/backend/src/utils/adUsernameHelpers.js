/**
 * Generación de sAMAccountName / localPart.
 * - Bases ordenadas (a)–(d) compartidas entre variantes.
 * - `iterateLocalPartCandidates`: cola AD / LDAP / prechequeo admin (oleada numérica escalonada).
 * - `iterateOperationalLocalPartCandidates`: solo usuarios operativos M365 (mismo sufijo .N en cada ciclo a–d).
 */

export const normalizeName = (name) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();

export const generateLocalPart = (givenName, surname) => {
  const normalizedGivenName = normalizeName(givenName);
  const normalizedSurname = normalizeName(surname);
  if (!normalizedGivenName || !normalizedSurname) {
    throw new Error('No se puede generar el nombre de usuario: nombre o apellido inválido');
  }
  return `${normalizedGivenName}.${normalizedSurname}`;
};

/** Máximo recomendado para sAMAccountName en AD (compatibilidad legada). */
export const SAM_MAX_LENGTH = 20;

/**
 * Trunca el localPart para sAMAccountName (≤ SAM_MAX_LENGTH).
 * Si termina en .número (homónimos), preserva el sufijo y trunca solo la base para que .1 y .2 no colisionen.
 */
export function truncateForSamAccountName(localPart) {
  if (!localPart || localPart.length <= SAM_MAX_LENGTH) return localPart;

  const m = localPart.match(/^(.+)\.(\d+)$/);
  if (m) {
    const base = m[1];
    const suffix = `.${m[2]}`;
    const maxBaseLen = SAM_MAX_LENGTH - suffix.length;
    if (maxBaseLen < 1) {
      return localPart.slice(0, SAM_MAX_LENGTH);
    }
    const truncatedBase = base.length > maxBaseLen ? base.slice(0, maxBaseLen) : base;
    return `${truncatedBase}${suffix}`;
  }

  return localPart.slice(0, SAM_MAX_LENGTH);
}

/** Oleadas escalonadas admin/LDAP: ~100 vueltas × k bases. */
const UPN_ADMIN_NUMERIC_WAVE_MAX_ROUNDS = 100;

/** Operativos M365: mismo N en (a)–(d) antes de N+1; máximo N por compatibilidad con tope admin. */
const UPN_OPERATIONAL_NUMERIC_MAX_COUNTER = 100;

/**
 * Lista `nombre.apellido` en orden (a) primer+apellido1, (b) primer+apellido2, (c) resto nombre+apellido1, (d)+apellido2.
 * Sin segundo apellido solo (a)(c) si hay segundo nombre; sin segundo nombre solo (a)(b).
 *
 * @param {string} givenName
 * @param {string} surname1
 * @param {string} [surname2]
 * @returns {string[]}
 */
export function buildOrderedLocalPartBases(givenName, surname1, surname2) {
  const g = givenName.trim();
  const s1 = surname1.trim();
  const s2 = surname2?.trim() || '';

  const nameParts = g.split(/\s+/).filter(Boolean);
  const primaryGivenName = nameParts[0] || g;
  const secondaryGivenName =
    nameParts.length > 1 ? nameParts.slice(1).join(' ').trim() || null : null;

  /** @type {string[]} */
  const bases = [];
  const pushUnique = (given, surname) => {
    const lp = generateLocalPart(given, surname);
    if (!bases.includes(lp)) bases.push(lp);
  };

  pushUnique(primaryGivenName, s1);
  if (s2) pushUnique(primaryGivenName, s2);
  if (secondaryGivenName) {
    pushUnique(secondaryGivenName, s1);
    if (s2) pushUnique(secondaryGivenName, s2);
  }

  /** @type {string[]} */
  const ordered = [];
  for (const b of bases) {
    if (ordered.length === 0 || ordered[ordered.length - 1] !== b) {
      ordered.push(b);
    }
  }
  return ordered;
}

/**
 * Candidatos para cola AD / LDAP y prechequeo Graph administrativo (oleada escalonada).
 * 1) Bases sin sufijo (a)–(d). 2) B[0].1, B[1].2, …, B[k-1].k; siguiente vuelta B[0].(k+1), …
 *
 * @param {string} givenName
 * @param {string} surname1
 * @param {string} [surname2]
 * @returns {Generator<string>}
 */
export function* iterateLocalPartCandidates(givenName, surname1, surname2) {
  const ordered = buildOrderedLocalPartBases(givenName, surname1, surname2);
  const k = ordered.length;
  if (k === 0) return;

  for (const b of ordered) {
    yield b;
  }

  const start = 1;
  for (let round = 0; round < UPN_ADMIN_NUMERIC_WAVE_MAX_ROUNDS; round++) {
    for (let i = 0; i < k; i++) {
      const n = start + round * k + i;
      yield `${ordered[i]}.${n}`;
    }
  }
}

/**
 * Solo usuarios operativos en Microsoft 365 (Entra ID): mismas bases (a)–(d), luego para cada N=1,2,…
 * prueba B[0].N, B[1].N, …, B[k-1].N antes de incrementar N.
 *
 * @param {string} givenName
 * @param {string} surname1
 * @param {string} [surname2]
 * @returns {Generator<string>}
 */
export function* iterateOperationalLocalPartCandidates(givenName, surname1, surname2) {
  const ordered = buildOrderedLocalPartBases(givenName, surname1, surname2);
  const k = ordered.length;
  if (k === 0) return;

  for (const b of ordered) {
    yield b;
  }

  for (let counter = 1; counter <= UPN_OPERATIONAL_NUMERIC_MAX_COUNTER; counter++) {
    for (let i = 0; i < k; i++) {
      yield `${ordered[i]}.${counter}`;
    }
  }
}
