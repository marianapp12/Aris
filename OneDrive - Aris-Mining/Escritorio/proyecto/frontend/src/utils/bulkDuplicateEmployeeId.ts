import type {
  CheckExistingPersonResponse,
  EmployeeIdDuplicateCheck,
  ExistingPersonDirectoryMatch,
} from '../types/user';

/** Cédula ya usada: no se permite encolar otra creación administrativa con el mismo documento. */
export function isAdministrativeBulkEmployeeIdBlocked(
  check: CheckExistingPersonResponse
): boolean {
  const dup = check.employeeIdDuplicate;
  if (!dup) return false;
  return Boolean(
    dup.activeDirectory ||
    dup.queuePending ||
    dup.queueProcessed ||
    dup.microsoft365
  );
}

export type EmployeeIdDuplicateSource = {
  key: string;
  label: string;
  match: ExistingPersonDirectoryMatch;
};

/** Fuentes de duplicado de cédula con datos para mostrar en el modal masivo. */
export function listEmployeeIdDuplicateSources(
  dup: EmployeeIdDuplicateCheck | null | undefined
): EmployeeIdDuplicateSource[] {
  if (!dup) return [];
  const out: EmployeeIdDuplicateSource[] = [];
  if (dup.activeDirectory) {
    out.push({
      key: 'ad',
      label: 'Active Directory (cédula en el directorio)',
      match: dup.activeDirectory,
    });
  }
  if (dup.queueProcessed) {
    out.push({
      key: 'processed',
      label: 'Active Directory (ya procesado en cola)',
      match: dup.queueProcessed,
    });
  }
  if (dup.queuePending) {
    out.push({
      key: 'pending',
      label: 'Cola Active Directory (pendiente)',
      match: dup.queuePending,
    });
  }
  if (dup.microsoft365) {
    out.push({
      key: 'm365',
      label: 'Microsoft 365 (id. de empleado)',
      match: dup.microsoft365,
    });
  }
  return out;
}
