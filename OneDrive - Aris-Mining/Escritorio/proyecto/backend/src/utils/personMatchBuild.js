/**
 * @typedef {object} PersonDirectoryMatch
 * @property {string} displayName
 * @property {string} [userPrincipalName]
 * @property {string} [samAccountName]
 * @property {string} [email]
 * @property {string} [department]
 * @property {string} [jobTitle]
 * @property {string} [sede]
 * @property {string} [employeeId]
 * @property {string} [postalCode]
 */

/**
 * @param {Record<string, unknown>} fields
 * @returns {PersonDirectoryMatch}
 */
export function buildPersonMatch(fields) {
  /** @type {PersonDirectoryMatch} */
  const out = { displayName: String(fields.displayName || '').trim() };
  const optionalKeys = [
    'userPrincipalName',
    'samAccountName',
    'email',
    'department',
    'jobTitle',
    'sede',
    'employeeId',
    'postalCode',
  ];
  for (const key of optionalKeys) {
    const v = fields[key];
    if (v != null && String(v).trim()) {
      out[key] = String(v).trim();
    }
  }
  return out;
}
