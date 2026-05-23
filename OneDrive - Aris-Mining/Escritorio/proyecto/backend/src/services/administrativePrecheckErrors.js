export const PRECHECK_CODES = {
  EMPLOYEE_ID_IN_USE: 'EMPLOYEE_ID_IN_USE',
  /** Cédula en AD (LDAP), sin depender de sync a la nube. */
  EMPLOYEE_ID_IN_USE_AD: 'EMPLOYEE_ID_IN_USE_AD',
  EMPLOYEE_ID_AMBIGUOUS: 'EMPLOYEE_ID_AMBIGUOUS',
  GRAPH_UNAVAILABLE: 'GRAPH_UNAVAILABLE',
  AD_LDAP_UNAVAILABLE: 'AD_LDAP_UNAVAILABLE',
  /** Cédula en pendiente-*.json (Graph aún no la indexa). */
  EMPLOYEE_ID_PENDING_IN_QUEUE: 'EMPLOYEE_ID_PENDING_IN_QUEUE',
  /** Cédula en procesados (AD listo; Entra puede ir retrasado). */
  EMPLOYEE_ID_IN_PROCESSED_RECORDS: 'EMPLOYEE_ID_IN_PROCESSED_RECORDS',
  NO_UPN_AVAILABLE: 'NO_UPN_AVAILABLE',
};

export class AdministrativePrecheckError extends Error {
  constructor(code, message, httpStatus) {
    super(message);
    this.name = 'AdministrativePrecheckError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
