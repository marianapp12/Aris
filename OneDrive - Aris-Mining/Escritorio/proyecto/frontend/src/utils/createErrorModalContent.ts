/** Contenido estructurado para el modal de error al crear o verificar. */
export interface CreateErrorModalContent {
  title: string;
  personName?: string;
  body: string;
  hint?: string;
}

function extractCedulaDuplicateContext(msg: string) {
  const employeeId = msg.match(/cédula\s*\/\s*ID\s*"([^"]+)"/i)?.[1]?.trim();
  const asociada =
    msg.match(/Asociada a:\s*([^.]+)\./i)?.[1]?.trim() ||
    msg.match(/Active Directory\s*\(([^)]+)\)/i)?.[1]?.trim();
  const hintMatch = msg.match(/Microsoft 365[^.]*(?:\.|$)/i);
  return {
    employeeId,
    personName: asociada,
    hint: hintMatch?.[0].replace(/\.$/, ''),
  };
}

function buildCedulaDuplicateModal(msg: string): CreateErrorModalContent {
  const { employeeId, personName, hint } = extractCedulaDuplicateContext(msg);
  const bodyParts = [
    employeeId
      ? `La cédula / ID "${employeeId}" ya está registrada en el sistema.`
      : 'La cédula / ID ingresada ya está registrada en el sistema.',
    'No puede dar de alta otra persona con el mismo documento.',
  ];
  if (personName) {
    bodyParts.push(`Está asociada a: ${personName}.`);
  }
  return {
    title: 'Cédula ya registrada',
    personName,
    body: bodyParts.join(' '),
    hint:
      hint ||
      'Microsoft 365 puede tardar varios minutos en reflejar la cuenta tras Azure AD Connect.',
  };
}

/**
 * Convierte mensajes largos del API en título, cuerpo y nota para el modal.
 */
export function parseCreateErrorForModal(rawMessage: string): CreateErrorModalContent {
  const msg = rawMessage.trim();
  if (!msg) {
    return {
      title: 'No se pudo completar la operación',
      body: 'Ocurrió un error desconocido. Intente de nuevo o contacte a soporte.',
    };
  }

  if (
    /cédula\s*\/\s*ID.*ya está registrada/i.test(msg) ||
    /ya está en proceso de creación o ya fue creado recientemente en Active Directory/i.test(msg)
  ) {
    return buildCedulaDuplicateModal(msg);
  }

  if (/Ya hay una solicitud en cola/i.test(msg)) {
    const idMatch = msg.match(/cédula\s*\/\s*ID\s*"([^"]+)"/i);
    return {
      title: 'Cédula ya tiene solicitud en cola',
      personName: idMatch?.[1],
      body: msg.replace(/\s*Microsoft 365.*$/i, '').trim(),
      hint: /Microsoft 365/i.test(msg)
        ? 'Espere a que el servidor procese el archivo pendiente antes de volver a enviar la misma cédula.'
        : undefined,
    };
  }

  if (/No se pudo verificar si la persona ya existe/i.test(msg)) {
    return {
      title: 'Error al verificar duplicados',
      body: msg.replace(/\s*\(HTTP \d+\)\.?\s*$/i, '').trim(),
      hint: 'Revise la conexión con el servidor y la configuración de Microsoft 365 en el backend.',
    };
  }

  if (/Usuario ya existe|UPN|nombre de cuenta/i.test(msg)) {
    return {
      title: 'Cuenta técnica no disponible',
      body: msg,
    };
  }

  return {
    title: 'No se pudo completar la creación',
    body: msg,
  };
}
