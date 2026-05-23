/** sAM/localPart: bases (a)–(d); admin = oleadas escalonadas; operativo M365 = .N en cada ciclo (a)–(d). */

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

export const SAM_MAX_LENGTH = 20;

/** Trunca sAM; con sufijo .N preserva el número para no colisionar homónimos. */
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

const UPN_ADMIN_NUMERIC_WAVE_MAX_ROUNDS = 100;
const UPN_OPERATIONAL_NUMERIC_MAX_COUNTER = 100;

/** Bases (a)–(d): primer+apellidos y segundo nombre si aplica. */
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

/** Admin/LDAP: bases sin sufijo, luego oleada B[i].n escalonada. */
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

/** Operativo M365: por cada N, prueba B[0].N … B[k-1].N antes de N+1. */
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
