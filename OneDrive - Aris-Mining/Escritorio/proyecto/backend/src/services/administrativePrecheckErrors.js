export const PRECHECK_CODES = {
  EMPLOYEE_ID_IN_USE: 'EMPLOYEE_ID_IN_USE',
  /** Cédula duplicada detectada en AD on-premises (LDAP), sin depender de la sincronización con la nube. */
  EMPLOYEE_ID_IN_USE_AD: 'EMPLOYEE_ID_IN_USE_AD',
  EMPLOYEE_ID_AMBIGUOUS: 'EMPLOYEE_ID_AMBIGUOUS',
  GRAPH_UNAVAILABLE: 'GRAPH_UNAVAILABLE',
  /** Error de conexión o consulta LDAP cuando el prechequeo AD está configurado. */
  AD_LDAP_UNAVAILABLE: 'AD_LDAP_UNAVAILABLE',
  /** Misma cédula ya presente en un pendiente-*.json en la cola SMB (Graph aún no la ve). */
  EMPLOYEE_ID_PENDING_IN_QUEUE: 'EMPLOYEE_ID_PENDING_IN_QUEUE',
  /** Cédula ya registrada en carpeta procesados (alta completada en AD por PS; Entra ID puede ir atrasado). */
  EMPLOYEE_ID_IN_PROCESSED_RECORDS: 'EMPLOYEE_ID_IN_PROCESSED_RECORDS',
  NO_UPN_AVAILABLE: 'NO_UPN_AVAILABLE',
};

export class AdministrativePrecheckError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} httpStatus
   */
  constructor(code, message, httpStatus) {
    super(message);
    this.name = 'AdministrativePrecheckError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
