import type { CheckExistingPersonResponse } from '../types/user';

/** Modal de duplicados solo con coincidencia real (no solo avisos de Graph). */
export function shouldOpenDuplicateModal(check: CheckExistingPersonResponse): boolean {
  return check.exists === true && (check.foundIn?.length ?? 0) > 0;
}

export const DUPLICATE_CHECK_UI = {
  verifyingPerson: 'Verificando si la persona ya existe…',
  verifyingBulk: 'Verificando duplicados en el archivo…',
  verifyingBulkShort: 'Verificando duplicados…',
  creatingOperational: 'Creando usuario en Microsoft 365…',
  creatingAdministrative: 'Encolando en Active Directory…',
  creatingOperationalHint:
    'La primera creación tras reiniciar el servidor puede tardar unos segundos más.',
  creatingAdministrativeHint: 'La solicitud quedará en cola hasta que el servidor la procese.',
  verificationIncompleteTitle: 'Verificación incompleta; revise antes de continuar.',
  modalTitle: 'Persona ya registrada',
  modalLeadSuffix: 'Revise si es la misma persona antes de continuar.',
  modalConfirmOperational:
    'Si confirma, se creará el usuario en Microsoft 365 de todas formas (puede generarse otra cuenta técnica con sufijo distinto).',
  modalConfirmAdministrative:
    'Si confirma, se encolará la solicitud en Active Directory de todas formas (puede generarse otra cuenta técnica con sufijo distinto).',
  bulkModalTitle: 'Coincidencias en el Excel',
} as const;

export function duplicateModalConfirmFootnote(
  creationType: 'operational' | 'administrative'
): string {
  return creationType === 'operational'
    ? DUPLICATE_CHECK_UI.modalConfirmOperational
    : DUPLICATE_CHECK_UI.modalConfirmAdministrative;
}

export function createButtonLabel(
  creationType: 'operational' | 'administrative',
  phase: 'idle' | 'verifying' | 'creating'
): string {
  if (phase === 'verifying') return DUPLICATE_CHECK_UI.verifyingPerson;
  if (phase === 'creating') {
    return creationType === 'operational'
      ? DUPLICATE_CHECK_UI.creatingOperational
      : DUPLICATE_CHECK_UI.creatingAdministrative;
  }
  return creationType === 'operational'
    ? 'Crear usuario operativo'
    : 'Crear usuario administrativo (AD)';
}

export function createStatusHint(creationType: 'operational' | 'administrative'): string {
  return creationType === 'operational'
    ? DUPLICATE_CHECK_UI.creatingOperationalHint
    : DUPLICATE_CHECK_UI.creatingAdministrativeHint;
}
