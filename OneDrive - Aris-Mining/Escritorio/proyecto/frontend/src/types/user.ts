export interface CreateUserRequest {
  givenName: string;
  surname1: string;
  surname2?: string;
  jobTitle: string;
  department: string;
  /** Solo usuarios operativos: una de OPERATIONAL_SEDE_OPTIONS */
  sede?: string;
  /** Centro de costos (UI) opcional en operativos (M365) y administrativos (cola AD). Solo dígitos (4–10) cuando se informa. Body: `postalCode`. */
  postalCode?: string;
  /** Cédula / ID empleado (pestaña administrativa, opcional) */
  employeeId?: string;
  /** Sede administrativa: nombre en AD (City), p. ej. Bogotá, Medellín; la OU la resuelve el backend. */
  city?: string;
}

/** Detalle seguro del rechazo de Microsoft Graph (sin cuerpo completo). */
export interface OperationalGroupGraphError {
  httpStatus?: number;
  code?: string;
  message?: string;
}

/** Un grupo M365 al que se intentó agregar el usuario operativo. */
export interface OperationalGroupMembershipResult {
  kind: 'sede' | 'sede-operarios' | 'sede-colaboradores' | 'common';
  sede?: string;
  groupRole?: 'operarios' | 'colaboradores';
  groupObjectId?: string;
  groupDisplayName?: string;
  memberAdded: boolean;
  graphError?: OperationalGroupGraphError;
}

export interface CreateUserResponse {
  id: string;
  userPrincipalName: string;
  displayName: string;
  email: string;
  message?: string;
  /** Respuesta de alta operativo (Microsoft 365 + grupos). */
  sede?: string;
  groupObjectId?: string;
  groupMemberAdded?: boolean;
  groupMemberships?: OperationalGroupMembershipResult[];
}

export interface NextUsernameResponse {
  userName: string;
  userPrincipalName: string;
}

/** Coincidencia en directorio (M365 o AD) al verificar nombre + apellidos. */
export interface ExistingPersonDirectoryMatch {
  displayName: string;
  userPrincipalName?: string;
  samAccountName?: string;
  email?: string;
  department?: string;
  jobTitle?: string;
  /** Sede (Graph `city` / AD `l`). */
  sede?: string;
  employeeId?: string;
  postalCode?: string;
}

/** Duplicidad de cédula detectada en M365 y/o carpetas de cola AD. */
export interface EmployeeIdDuplicateCheck {
  microsoft365: ExistingPersonDirectoryMatch | null;
  queuePending: ExistingPersonDirectoryMatch | null;
  queueProcessed: ExistingPersonDirectoryMatch | null;
}

/** Fila del prechequeo masivo Excel antes de crear/encolar. */
export interface BulkPrecheckRowResult {
  row: number;
  displayName: string;
  exists: boolean;
  check: CheckExistingPersonResponse | null;
  skipPrecheck?: boolean;
  message?: string;
}

/** POST .../bulk-precheck */
export interface BulkPrecheckApiResponse {
  message?: string;
  totalRows: number;
  duplicateCount: number;
  rows: BulkPrecheckRowResult[];
}

/** POST /api/users/check-existing-person */
export interface CheckExistingPersonResponse {
  exists: boolean;
  displayName: string;
  /** Fuentes donde hubo coincidencia (p. ej. microsoft365, queuePending, employeeIdQueueProcessed). */
  foundIn: string[];
  microsoft365: ExistingPersonDirectoryMatch | null;
  activeDirectory: ExistingPersonDirectoryMatch | null;
  /** Solicitud en cola (pending/procesando) con el mismo nombre o cédula. */
  queuePending: ExistingPersonDirectoryMatch | null;
  /** Registro en procesados (usuario ya creado en AD por el script). */
  queueProcessed: ExistingPersonDirectoryMatch | null;
  /** Alta operativa M365 o resultado previo en cola (mismo nombre). */
  queueHistorical?: ExistingPersonDirectoryMatch | null;
  employeeIdDuplicate: EmployeeIdDuplicateCheck | null;
  /** Avisos si Graph u otra fuente no pudo consultarse (exists puede ser false). */
  verificationWarnings?: string[];
}

/** Respuesta 202 al encolar creación o actualización administrativa vía carpeta compartida (SMB). */
export interface AdQueueCreationAccepted {
  requestId: string;
  message: string;
  queuePath: string;
  /** Ausente si queueAction es actualización por cédula existente. */
  proposedUserName?: string;
  /** Puede ser el UPN conocido en Graph al encolar una actualización. */
  userPrincipalName?: string;
  displayName: string;
  queueAction?: 'create' | 'updateByEmployeeId';
  /** DN de la OU de destino en AD (ciudad/sede, AD_QUEUE_OU_DN y opcional AD_QUEUE_OU_LEAF_PREFIX). */
  adOrganizationalUnitDn?: string;
}

/** GET /users/administrative/queue-connection-test — prueba escritura en AD_QUEUE_UNC. */
export interface AdQueueConnectionTestResult {
  ok: boolean;
  message: string;
  uncPath?: string;
  code?: string;
}

/** GET .../administrative/queue-requests/:requestId/result — estado tras ejecutar el script PS. */
export type AdQueueJobStatus = 'pending' | 'success' | 'error';

/** Una fila devuelta por POST .../administrative/bulk (encolado por fila). */
export interface AdministrativeBulkRowResult {
  row: number;
  status: string;
  userPrincipalName?: string;
  displayName?: string;
  requestId?: string;
  proposedUserName?: string;
  queueAction?: 'create' | 'updateByEmployeeId';
  message?: string;
  code?: string;
  /** DN de la OU de destino cuando el backend lo incluye (alineado con AdQueueCreationAccepted). */
  adOrganizationalUnitDn?: string;
}

export interface AdQueueRequestResult {
  status: AdQueueJobStatus;
  message: string;
  requestId: string;
  processedAt?: string;
  queueAction?: string;
  /** Nombre para mostrar en AD tras procesar el script (opcional en JSON antiguos). */
  displayName?: string;
  samAccountName?: string;
  /** UPN final en AD (tras resolver colisiones en el script PowerShell). */
  userPrincipalName?: string;
  /** Correo principal en AD (puede coincidir con el UPN u ser el alias del pendiente). */
  email?: string;
}

/** Valores exactos enviados al backend (operativos). */
export const OPERATIONAL_SEDE_OPTIONS = [
  'Medellín',
  'Segovia',
  'Marmato',
  'Bogotá',
  'Bucaramanga',
] as const;

export interface UserFormData {
  primerNombre: string;
  segundoNombre: string;
  apellido1: string;
  apellido2: string;
  puesto: string;
  departamento: string;
  /** Solo pestaña operativa (obligatorio al crear operativo). */
  sede: string;
  /** Centro de costos (operativo): solo números, 4–10 dígitos. */
  postalCode: string;
  cedula: string;
  /** Administrativo: sede elegida (mismo texto que en AD City); operativo puede quedar vacío. */
  ciudad: string;
}
