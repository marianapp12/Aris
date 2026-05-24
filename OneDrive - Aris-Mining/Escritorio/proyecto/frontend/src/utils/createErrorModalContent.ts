/** Contenido estructurado para el modal de error al crear o verificar. */
export interface CreateErrorModalContent {
  title: string;
  personName?: string;
  body: string;
  hint?: string;
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
    /ya está en proceso de creación o ya fue creado recientemente en Active Directory/i.test(
      msg
    )
  ) {
    const personName = msg.match(/\(([^)]+)\)/)?.[1]?.trim();
    const hintMatch = msg.match(/Microsoft 365[^.]*(?:\.|$)/i);
    return {
      title: 'Usuario ya registrado en Active Directory',
      personName,
      body: 'Esta persona ya está en proceso de creación en Active Directory o fue creada hace poco. No se encoló una nueva solicitud con los mismos datos.',
      hint:
        hintMatch?.[0].replace(/\.$/, '') ||
        'Microsoft 365 puede tardar varios minutos en reflejar la cuenta tras Azure AD Connect.',
    };
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
