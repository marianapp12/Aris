import { checkExistingPersonByName } from '../services/personNameExistsCheck.js';

const onlyLettersRegex = /[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s-]/;

/** POST /api/users/check-existing-person — duplicados por nombre (y cédula en admin) antes de crear. */
export const checkExistingPerson = async (req, res) => {
  const givenName = String(req.body?.givenName ?? '').trim();
  const surname1 = String(req.body?.surname1 ?? '').trim();
  const surname2 = String(req.body?.surname2 ?? '').trim();
  const employeeId = String(req.body?.employeeId ?? '').trim();

  if (!givenName) {
    return res.status(400).json({
      error: 'VALIDATION',
      message: 'givenName es obligatorio.',
    });
  }
  if (!surname1) {
    return res.status(400).json({
      error: 'VALIDATION',
      message: 'surname1 (primer apellido) es obligatorio.',
    });
  }
  if (onlyLettersRegex.test(givenName) || onlyLettersRegex.test(surname1)) {
    return res.status(400).json({
      error: 'VALIDATION',
      message: 'Nombre o apellido con caracteres no permitidos.',
    });
  }
  if (surname2 && onlyLettersRegex.test(surname2)) {
    return res.status(400).json({
      error: 'VALIDATION',
      message: 'Segundo apellido con caracteres no permitidos.',
    });
  }

  try {
    const result = await checkExistingPersonByName({
      givenName,
      surname1,
      surname2: surname2 || undefined,
      employeeId: employeeId || undefined,
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error('[check-existing-person]', err?.stack || err);
    return res.status(500).json({
      error: 'CHECK_FAILED',
      message: 'No se pudo verificar si la persona ya existe en el directorio.',
      detail: process.env.NODE_ENV !== 'production' ? String(err?.message || err) : undefined,
    });
  }
};
