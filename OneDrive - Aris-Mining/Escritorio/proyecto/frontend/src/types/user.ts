export interface CreateUserRequest {
  givenName: string;
  surname1: string;
  surname2?: string;
  jobTitle: string;
  department: string;
  /** Cédula / ID empleado (pestaña administrativa, opcional) */
  employeeId?: string;
  /** Ciudad (pestaña administrativa, opcional) */
  city?: string;
}

export interface CreateUserResponse {
  id: string;
  userPrincipalName: string;
  displayName: string;
  email: string;
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

export interface UserFormData {
  primerNombre: string;
  segundoNombre: string;
  apellido1: string;
  apellido2: string;
  puesto: string;
  departamento: string;
  cedula: string;
  ciudad: string;
}

export interface UserPreview {
  displayName: string;
  userName: string;
  email: string;
}
