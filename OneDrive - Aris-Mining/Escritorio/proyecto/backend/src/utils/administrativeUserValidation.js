const onlyLettersRegex = /[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s-]/;
const hasInvalidCharsForName = (value) => value && onlyLettersRegex.test(value);
/** Cédula / ID: alfanumérico y guion, 5–32 caracteres (obligatorio en flujo administrativo). */
export const EMPLOYEE_ID_MIN_LENGTH = 5;
export const EMPLOYEE_ID_MAX_LENGTH = 32;
const employeeIdRegex = new RegExp(
  `^[0-9A-Za-z-]{${EMPLOYEE_ID_MIN_LENGTH},${EMPLOYEE_ID_MAX_LENGTH}}$`
);
const cityRegex = /^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ0-9\s.,-]{0,60}$/;

/** Alineado con flujo operativo M365 (código postal). */
export const ADMIN_POSTAL_MIN = 4;
export const ADMIN_POSTAL_MAX = 10;

const jobDeptAllowedRegex = /^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ0-9\s.,\-/&()+]+$/;
const hasInvalidCharsForJobOrDept = (value) => {
  const v = String(value || '').trim();
  return Boolean(v && !jobDeptAllowedRegex.test(v));
};

export function normalizeAdministrativePostalCode(raw) {
  return String(raw ?? '')
    .replace(/\s/g, '')
    .trim();
}

function isValidAdministrativePostalDigits(normalized) {
  if (!normalized || !/^\d+$/.test(normalized)) return false;
  const len = normalized.length;
  return len >= ADMIN_POSTAL_MIN && len <= ADMIN_POSTAL_MAX;
}

export function validateAdministrativePayload(body) {
  const { givenName, surname1, surname2, jobTitle, department, employeeId, city, postalCode } = body;

  if (!givenName || !surname1 || !jobTitle || !department) {
    return {
      ok: false,
      status: 400,
      error: 'Campos obligatorios faltantes',
      message:
        'Los campos nombre, primer apellido, puesto y departamento son obligatorios',
    };
  }

  const idTrimmed = employeeId != null ? String(employeeId).trim() : '';
  if (!idTrimmed) {
    return {
      ok: false,
      status: 400,
      error: 'Validación fallida',
      message: 'La cédula / ID de empleado es obligatoria',
    };
  }

  if (!employeeIdRegex.test(idTrimmed)) {
    return {
      ok: false,
      status: 400,
      error: 'Validación fallida',
      message: `La cédula / ID debe ser alfanumérica (guiones permitidos), entre ${EMPLOYEE_ID_MIN_LENGTH} y ${EMPLOYEE_ID_MAX_LENGTH} caracteres`,
    };
  }

  const postalNorm = normalizeAdministrativePostalCode(postalCode);
  if (!postalNorm) {
    return {
      ok: false,
      status: 400,
      error: 'Validación fallida',
      message: 'El código postal (postalCode) es obligatorio',
    };
  }
  if (!isValidAdministrativePostalDigits(postalNorm)) {
    return {
      ok: false,
      status: 400,
      error: 'Validación fallida',
      message: `Código postal: solo números, entre ${ADMIN_POSTAL_MIN} y ${ADMIN_POSTAL_MAX} dígitos`,
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

  if (hasInvalidCharsForJobOrDept(jobTitle)) {
    return {
      ok: false,
      status: 400,
      error: 'Validación fallida',
      message:
        'Puesto: use solo letras, números, espacios y los signos . , - / & ( ) +',
    };
  }
  if (hasInvalidCharsForJobOrDept(department)) {
    return {
      ok: false,
      status: 400,
      error: 'Validación fallida',
      message:
        'Departamento: use solo letras, números, espacios y los signos . , - / & ( ) +',
    };
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
