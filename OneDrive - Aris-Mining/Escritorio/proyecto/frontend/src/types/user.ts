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

/** Resultado final del trabajo asíncrono (PowerShell / AD). */
export interface CreateAdministrativeUserResponse {
  distinguishedName?: string | null;
  sAMAccountName: string;
  userPrincipalName: string;
  displayName: string;
  email: string;
  message?: string;
}

/** Respuesta 202 al encolar creación administrativa. */
export interface AdministrativeCreationAccepted {
  jobId: string;
  statusUrl: string;
  message: string;
}

export interface AdministrativeJobStatus {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: string;
  result?: CreateAdministrativeUserResponse;
  error?: string;
  log?: string;
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
