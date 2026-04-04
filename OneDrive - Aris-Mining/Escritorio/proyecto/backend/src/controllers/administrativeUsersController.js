import {
  enqueueAdministrativeUserCreation,
  getAdministrativeJobStatus,
  getNextAvailableAdministrativeUsernamePs,
} from '../services/adPowerShellUserService.js';

const onlyLettersRegex = /[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s-]/;
const hasInvalidCharsForName = (value) => value && onlyLettersRegex.test(value);
const employeeIdRegex = /^[0-9A-Za-z-]{0,32}$/;
const cityRegex = /^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ0-9\s.,-]{0,60}$/;

function validateAdministrativePayload(body) {
  const { givenName, surname1, surname2, jobTitle, department, employeeId, city } = body;

  if (!givenName || !surname1 || !jobTitle || !department) {
    return {
      ok: false,
      status: 400,
      error: 'Campos obligatorios faltantes',
      message:
        'Los campos nombre, primer apellido, puesto y departamento son obligatorios',
    };
  }

  if (givenName.trim().length < 3 || surname1.trim().length < 3) {
    return {
      ok: false,
      status: 400,
      error: 'Validación fallida',
      message: 'El nombre y primer apellido deben tener al menos 3 caracteres',
    };
  }

  const maxLength = 50;
  if (
    givenName.trim().length > maxLength ||
    surname1.trim().length > maxLength ||
    (surname2 && surname2.trim().length > maxLength) ||
    jobTitle.trim().length > maxLength ||
    department.trim().length > maxLength
  ) {
    return {
      ok: false,
      status: 400,
      error: 'Validación fallida',
      message: `Los campos no pueden exceder ${maxLength} caracteres`,
    };
  }

  if (
    hasInvalidCharsForName(givenName) ||
    hasInvalidCharsForName(surname1) ||
    hasInvalidCharsForName(surname2)
  ) {
    return {
      ok: false,
      status: 400,
      error: 'Validación fallida',
      message: 'Los nombres y apellidos solo pueden contener letras',
    };
  }

  if (employeeId != null && String(employeeId).trim() !== '') {
    if (!employeeIdRegex.test(String(employeeId).trim())) {
      return {
        ok: false,
        status: 400,
        error: 'Validación fallida',
        message: 'La cédula / ID debe ser alfanumérica (máx. 32 caracteres)',
      };
    }
  }

  if (city != null && String(city).trim() !== '') {
    const c = String(city).trim();
    if (c.length > 60) {
      return {
        ok: false,
        status: 400,
        error: 'Validación fallida',
        message: 'Ciudad no puede exceder 60 caracteres',
      };
    }
    if (!cityRegex.test(c)) {
      return {
        ok: false,
        status: 400,
        error: 'Validación fallida',
        message: 'Ciudad con caracteres no permitidos',
      };
    }
  }

  return { ok: true };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST /api/users/administrative — 202 Accepted + jobId
 */
export const createAdministrativeUser = async (req, res) => {
  const validation = validateAdministrativePayload(req.body);
  if (!validation.ok) {
    return res.status(validation.status).json({
      error: validation.error,
      message: validation.message,
    });
  }

  const { givenName, surname1, surname2, jobTitle, department, employeeId, city } = req.body;

  try {
    const jobId = enqueueAdministrativeUserCreation({
      givenName: givenName.trim(),
      surname1: surname1.trim(),
      surname2: surname2?.trim(),
      jobTitle: jobTitle.trim(),
      department: department.trim(),
      employeeId: employeeId?.trim(),
      city: city?.trim(),
    });

    return res.status(202).json({
      jobId,
      statusUrl: `/api/users/administrative/jobs/${jobId}`,
      message:
        'Creación encolada. Consulte el estado del trabajo; puede tardar varios minutos (sincronización / replicación).',
    });
  } catch (error) {
    const msg = error?.message || String(error);
    if (msg.includes('Falta la variable de entorno') || msg.includes('Falta AD_PS_')) {
      return res.status(503).json({
        error: 'Configuración PowerShell / AD incompleta',
        message: msg,
      });
    }
    console.error('[AD-PS] Error al encolar creación administrativa:', msg);
    return res.status(500).json({
      error: 'Error interno',
      message:
        process.env.NODE_ENV === 'development' ? msg : 'No se pudo iniciar la creación del usuario',
    });
  }
};

/**
 * GET /api/users/administrative/jobs/:jobId
 */
export const getAdministrativeUserJob = async (req, res) => {
  const { jobId } = req.params;
  if (!jobId || !UUID_RE.test(jobId)) {
    return res.status(400).json({ error: 'jobId inválido' });
  }
  const status = getAdministrativeJobStatus(jobId);
  if (!status) {
    return res.status(404).json({ error: 'Trabajo no encontrado' });
  }
  return res.json(status);
};

/**
 * GET /api/users/administrative/next-username
 */
export const getNextAdministrativeUsername = async (req, res) => {
  try {
    const givenName = req.query.givenName?.trim() || '';
    const surname1 = req.query.surname1?.trim() || '';
    const surname2 = req.query.surname2?.trim() || '';

    if (!givenName || !surname1 || givenName.length < 3 || surname1.length < 3) {
      return res.status(400).json({
        error: 'Datos insuficientes',
        message: 'givenName y surname1 son obligatorios (mínimo 3 caracteres)',
      });
    }

    const { sAMAccountName, userPrincipalName } = await getNextAvailableAdministrativeUsernamePs({
      givenName,
      surname1,
      surname2,
    });

    return res.json({
      userName: sAMAccountName,
      userPrincipalName,
    });
  } catch (error) {
    const msg = error?.message || String(error);
    if (msg.includes('Falta la variable de entorno') || msg.includes('Falta AD_PS_')) {
      return res.status(503).json({
        error: 'Configuración PowerShell / AD incompleta',
        message: msg,
      });
    }
    console.error('[AD-PS] next-username administrativo:', msg);
    return res.status(500).json({
      error: 'Error interno',
      message:
        process.env.NODE_ENV === 'development'
          ? msg
          : 'No se pudo obtener el nombre de usuario sugerido',
    });
  }
};
