export interface CreateUserRequest {
  givenName: string;
  surname1: string;
  surname2?: string;
  jobTitle: string;
  department: string;
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

export interface UserFormData {
  primerNombre: string;
  segundoNombre: string;
  apellido1: string;
  apellido2: string;
  puesto: string;
  departamento: string;
}

export interface UserPreview {
  displayName: string;
  userName: string;
  email: string;
}
