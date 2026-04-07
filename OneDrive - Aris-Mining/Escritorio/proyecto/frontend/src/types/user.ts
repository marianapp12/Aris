export interface CreateUserRequest {
  givenName: string;
  surname1: string;
  surname2?: string;
  jobTitle: string;
  department: string;
  /** Solo usuarios operativos: una de OPERATIONAL_SEDE_OPTIONS */
  sede?: string;
  /** Código postal obligatorio: operativos (M365) y administrativos (cola AD). Solo dígitos (4–10). Body: `postalCode`. */
  postalCode?: string;
  /** Cédula / ID empleado (pestaña administrativa, opcional) */
  employeeId?: string;
  /** Ciudad (pestaña administrativa, opcional) */
  city?: string;
}

/** Detalle seguro del rechazo de Microsoft Graph (sin cuerpo completo). */
export interface OperationalGroupGraphError {
  httpStatus?: number;
  code?: string;
  message?: string;
}

/** Resultado por grupo (sede + comunes) tras crear operativo en Graph. */
export interface OperationalGroupMembershipResult {
  kind: 'sede' | 'common';
  groupObjectId?: string;
  /** Nombre del grupo en Entra ID (GET /groups/{id}); opcional si Graph no permite leerlo. */
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

export interface AdQueueRequestResult {
  status: AdQueueJobStatus;
  message: string;
  requestId: string;
  processedAt?: string;
  queueAction?: string;
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
  /** Código postal operativo: solo números, 4–10 dígitos. */
  postalCode: string;
  cedula: string;
  ciudad: string;
}

export interface UserPreview {
  displayName: string;
  userName: string;
  email: string;
}
