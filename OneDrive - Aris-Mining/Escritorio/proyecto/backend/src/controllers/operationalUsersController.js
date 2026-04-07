import { createUserInMicrosoft365, getNextAvailableUsername } from '../services/graphUserService.js';
import { addUserToGroup, getGroupDisplayName } from '../services/graphGroupMemberService.js';
import {
  isValidOperationalSede,
  getGroupObjectIdForSede,
  OPERATIONAL_SEDE_VALUES,
} from '../config/operationalSede.js';
import {
  getOperationalCommonGroupSlots,
  getOperationalCommonGroupDisplayNameSlots,
} from '../config/operationalGroups.js';
import { logGraphApiError } from '../utils/graphApiErrors.js';
import { parseOperationalBulkSheet } from '../utils/excelOperationalBulkParse.js';
import { mapWithConcurrency } from '../utils/asyncPool.js';
import XLSX from 'xlsx';

const OPERATIONAL_SEDE_LIST = OPERATIONAL_SEDE_VALUES.join(', ');

/** Controladoe de node.js creacion de usuarios en microsoft 365 */

/** Convierte a formato "Primera Letra Mayúscula" por palabra */
const toTitleCase = (value) =>
  value
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

/** Solo letras (incluye acentos, ñ, ü, espacios, guiones) para nombres y apellidos */
const onlyLettersRegex = /[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s-]/;
const hasInvalidCharsForName = (value) => value && onlyLettersRegex.test(value);

/**
 * Grupo por sede primero, luego ranuras comunes desde OPERATIONAL_COMMON_GROUP_IDS.
 * Dedupe de Object ID: no repite POST a Graph; el usuario ya quedó miembro en la primera asignación.
 *
 * @param {string} sedeNorm
 * @param {string} userObjectId
 * @returns {Promise<{ kind: 'sede' | 'common'; groupObjectId?: string; groupDisplayName?: string; memberAdded: boolean; graphError?: { httpStatus?: number; code?: string; message?: string } }[]>}
 */
async function enrichGroupMembershipsWithDisplayNames(memberships) {
  const commonLabels = getOperationalCommonGroupDisplayNameSlots();
  const out = [];
  for (const m of memberships) {
    const { commonSlotIndex, ...rest } = m;
    if (!m.groupObjectId) {
      out.push(rest);
      continue;
    }
    let groupDisplayName = await getGroupDisplayName(m.groupObjectId);
    if (
      !groupDisplayName &&
      m.kind === 'common' &&
      typeof commonSlotIndex === 'number' &&
      commonLabels[commonSlotIndex]
    ) {
      groupDisplayName = commonLabels[commonSlotIndex];
    }
    out.push({
      ...rest,
      ...(groupDisplayName ? { groupDisplayName } : {}),
    });
  }
  return out;
}

async function applyOperationalGroupMemberships(sedeNorm, userObjectId) {
  const sedeId = getGroupObjectIdForSede(sedeNorm);
  const commonSlots = getOperationalCommonGroupSlots();

  /** @type {{ id: string | null; kind: 'sede' | 'common'; commonSlotIndex?: number }[]} */
  const slots = [{ id: sedeId, kind: 'sede' }];
  let commonIdx = 0;
  for (const part of commonSlots) {
    slots.push({
      id: part ? part : null,
      kind: 'common',
      commonSlotIndex: commonIdx,
    });
    commonIdx += 1;
  }

  const seen = new Set();
  /** @type {{ kind: 'sede' | 'common'; commonSlotIndex?: number; groupObjectId?: string; memberAdded: boolean; graphError?: { httpStatus?: number; code?: string; message?: string } }[]} */
  const memberships = [];

  for (const slot of slots) {
    const commonMeta =
      slot.kind === 'common' && slot.commonSlotIndex !== undefined
        ? { commonSlotIndex: slot.commonSlotIndex }
        : {};

    if (!slot.id) {
      memberships.push({ kind: slot.kind, memberAdded: false, ...commonMeta });
      continue;
    }
    const key = slot.id.toLowerCase();
    if (seen.has(key)) {
      memberships.push({
        kind: slot.kind,
        groupObjectId: slot.id,
        memberAdded: true,
        ...commonMeta,
      });
      continue;
    }
    seen.add(key);
    const addResult = await addUserToGroup(slot.id, userObjectId);
    memberships.push({
      kind: slot.kind,
      groupObjectId: slot.id,
      memberAdded: addResult.ok,
      ...(addResult.graphError ? { graphError: addResult.graphError } : {}),
      ...commonMeta,
    });
  }

  return enrichGroupMembershipsWithDisplayNames(memberships);
}

function getOperationalBulkConcurrency() {
  const n = Number(process.env.OPERATIONAL_BULK_CONCURRENCY);
  if (Number.isFinite(n) && n >= 1 && n <= 20) return Math.floor(n);
  return 3;
}

/**
 * Una fila de la carga masiva Excel: validación + creación Graph + grupos.
 * @param {Record<string, unknown>} row
 * @param {number} rowNumber - fila en Excel (mensajes / resultado)
 * @param {Set<string>} bulkReservedUpnLower - UPN en minúsculas ya reservados en este mismo request bulk
 */
async function processOperationalBulkRow(row, rowNumber, bulkReservedUpnLower) {
  const primerNombre = (row.PrimerNombre || '').toString().trim();
  const segundoNombre = (row.SegundoNombre || '').toString().trim();
  const primerApellido = (row.PrimerApellido || '').toString().trim();
  const segundoApellido = (row.SegundoApellido || '').toString().trim();
  const puesto = (row.Puesto || '').toString().trim();
  const departamento = (row.Departamento || '').toString().trim();
  const sedeRaw = (row.Sede || '').toString().trim();

  if (!primerNombre || !primerApellido || !puesto || !departamento) {
    return {
      row: rowNumber,
      status: 'error',
      message:
        'Faltan campos obligatorios (PrimerNombre, PrimerApellido, Puesto, Departamento).',
    };
  }

  if (!isValidOperationalSede(sedeRaw)) {
    return {
      row: rowNumber,
      status: 'error',
      message: `Sede inválida o faltante. Use exactamente uno de: ${OPERATIONAL_SEDE_LIST} (columna Sede).`,
    };
  }

  if (primerNombre.length < 3 || primerApellido.length < 3) {
    return {
      row: rowNumber,
      status: 'error',
      message: 'PrimerNombre y PrimerApellido deben tener al menos 3 caracteres.',
    };
  }

  const maxLength = 50;
  if (
    primerNombre.length > maxLength ||
    primerApellido.length > maxLength ||
    (segundoNombre && segundoNombre.length > maxLength) ||
    (segundoApellido && segundoApellido.length > maxLength) ||
    puesto.length > maxLength ||
    departamento.length > maxLength ||
    sedeRaw.length > maxLength
  ) {
    return {
      row: rowNumber,
      status: 'error',
      message: `Los campos no pueden exceder ${maxLength} caracteres.`,
    };
  }

  if (hasInvalidCharsForName(primerNombre)) {
    return { row: rowNumber, status: 'error', message: 'PrimerNombre: solo se permiten letras.' };
  }
  if (segundoNombre && hasInvalidCharsForName(segundoNombre)) {
    return { row: rowNumber, status: 'error', message: 'SegundoNombre: solo se permiten letras.' };
  }
  if (hasInvalidCharsForName(primerApellido)) {
    return {
      row: rowNumber,
      status: 'error',
      message: 'PrimerApellido: solo se permiten letras.',
    };
  }
  if (segundoApellido && hasInvalidCharsForName(segundoApellido)) {
    return {
      row: rowNumber,
      status: 'error',
      message: 'SegundoApellido: solo se permiten letras.',
    };
  }

  const primerNombreNorm = toTitleCase(primerNombre);
  const segundoNombreNorm = segundoNombre ? toTitleCase(segundoNombre) : '';
  const primerApellidoNorm = toTitleCase(primerApellido);
  const segundoApellidoNorm = segundoApellido ? toTitleCase(segundoApellido) : '';
  const puestoNorm = puesto.toUpperCase();
  const departamentoNorm = departamento.toUpperCase();
  const givenName = [primerNombreNorm, segundoNombreNorm].filter(Boolean).join(' ');
  const sedeNorm = sedeRaw;

  try {
    const created = await createUserInMicrosoft365({
      givenName,
      surname1: primerApellidoNorm,
      surname2: segundoApellidoNorm || undefined,
      jobTitle: puestoNorm,
      department: departamentoNorm,
      bulkReservedUpnLower,
    });

    const groupMemberships = await applyOperationalGroupMemberships(sedeNorm, created.id);
    const sedeMembership = groupMemberships.find((m) => m.kind === 'sede');
    const groupId = sedeMembership?.groupObjectId;
    const groupMemberAdded = Boolean(
      sedeMembership?.groupObjectId && sedeMembership.memberAdded
    );

    return {
      row: rowNumber,
      status: 'success',
      id: created.id,
      userPrincipalName: created.userPrincipalName,
      displayName: created.displayName,
      sede: sedeNorm,
      groupMemberships,
      ...(groupId ? { groupObjectId: groupId } : {}),
      groupMemberAdded,
    };
  } catch (error) {
    logGraphApiError(`crear usuario operativo masivo fila ${rowNumber}`, error);
    return {
      row: rowNumber,
      status: 'error',
      message: error.message || 'Error al crear el usuario en Microsoft 365.',
    };
  }
}

/**
 * Controlador para crear un usuario operativo
 */
export const createOperationalUser = async (req, res, next) => {
  try {
    const { givenName, surname1, surname2, jobTitle, department, sede } = req.body;

    // Validación de campos obligatorios
    if (!givenName || !surname1 || !jobTitle || !department) {
      return res.status(400).json({
        error: 'Campos obligatorios faltantes',
        message: 'Los campos nombre, primer apellido, puesto y departamento son obligatorios',
      });
    }

    if (!isValidOperationalSede(sede)) {
      return res.status(400).json({
        error: 'Sede inválida',
        message: `El campo sede es obligatorio y debe ser uno de: ${OPERATIONAL_SEDE_LIST}.`,
      });
    }

    const sedeNorm = String(sede).trim();

    // Validación de longitud mínima colocar mas
    if (givenName.trim().length < 3 || surname1.trim().length < 3) {
      return res.status(400).json({
        error: 'Validación fallida',
        message: 'El nombre y primer apellido deben tener al menos 3 caracteres',
      });
    }

    // Validación de longitud máxima
    const maxLength = 50;
    if (
      givenName.trim().length > maxLength ||
      surname1.trim().length > maxLength ||
      (surname2 && surname2.trim().length > maxLength) ||
      jobTitle.trim().length > maxLength ||
      department.trim().length > maxLength
    ) {
      return res.status(400).json({
        error: 'Validación fallida',
        message: `Los campos no pueden exceder ${maxLength} caracteres`,
      });
    }

    // Crear usuario en Microsoft 365
    const result = await createUserInMicrosoft365({
      givenName: givenName.trim(),
      surname1: surname1.trim(),
      surname2: surname2?.trim(),
      jobTitle: jobTitle.trim(),
      department: department.trim(),
    });

    const groupMemberships = await applyOperationalGroupMemberships(sedeNorm, result.id);
    const sedeMembership = groupMemberships.find((m) => m.kind === 'sede');
    const groupId = sedeMembership?.groupObjectId;
    const groupMemberAdded = Boolean(
      sedeMembership?.groupObjectId && sedeMembership.memberAdded
    );

    // Respuesta exitosa
    res.status(201).json({
      id: result.id,
      userPrincipalName: result.userPrincipalName,
      displayName: result.displayName,
      email: result.userPrincipalName, // El userPrincipalName ya incluye el dominio
      message: 'Usuario creado exitosamente en Microsoft 365',
      sede: sedeNorm,
      groupMemberships,
      ...(groupId ? { groupObjectId: groupId } : {}),
      groupMemberAdded,
    });
  } catch (error) {
    logGraphApiError('crear usuario operativo', error);

    // Manejo de errores específicos de Microsoft Graph
    if (error.statusCode === 409) {
      return res.status(409).json({
        error: 'Usuario ya existe',
        message: 'Ya existe un usuario con ese nombre en Microsoft 365',
      });
    }

    if (error.statusCode === 401 || error.statusCode === 403) {
      return res.status(500).json({
        error: 'Error de autenticación',
        message: 'Error al autenticar con Microsoft 365. Verifique las credenciales de la aplicación.',
      });
    }

    if (error.statusCode === 400) {
      return res.status(400).json({
        error: 'Datos inválidos',
        message: error.message || 'Los datos proporcionados no son válidos para Microsoft 365',
      });
    }

    // Error genérico
    res.status(500).json({
      error: 'Error interno',
      message: error.message || 'Error al crear el usuario en Microsoft 365',
    });
  }
};

/**
 * GET /api/users/next-username
 * Devuelve el siguiente nombre de usuario disponible (sin crear el usuario).
 * Query: givenName, surname1, surname2 (opcional)
 */
export const getNextUsername = async (req, res) => {
  try {
    const givenName = req.query.givenName?.trim() || '';
    const surname1 = req.query.surname1?.trim() || '';
    const surname2 = req.query.surname2?.trim() || '';

    if (!givenName || !surname1 || givenName.length < 3 || surname1.length < 3) {
      return res.status(400).json({
        error: 'Datos insuficientes',
        message: 'Se requieren primerNombre y primerApellido con al menos 3 caracteres',
      });
    }

    const result = await getNextAvailableUsername({
      givenName,
      surname1,
      surname2,
    });
    res.json(result);
  } catch (error) {
    logGraphApiError('next-username operativo', error);
    if (error.statusCode === 401 || error.statusCode === 403) {
      return res.status(500).json({
        error: 'Error de autenticación',
        message: 'Error al conectar con Microsoft 365.',
      });
    }
    res.status(500).json({
      error: 'Error interno',
      message: error.message || 'No se pudo obtener el nombre de usuario disponible',
    });
  }
};

/**
 * POST /api/users/operational/bulk
 * Carga masiva de usuarios desde un archivo de Excel.
 * Plantilla recomendada:
 *  - Fila 1: título (opcional) — si existe, fila 2 = encabezados y datos desde fila 3
 *  - Sin fila de título: fila 1 = encabezados, datos desde fila 2
 * Encabezados: acepta "Primer Nombre", "PrimerNombre", sinónimos (Nombre→primer nombre, etc.) y Sede/Ubicación.
 * Valores de Sede: OPERATIONAL_SEDE_VALUES (operationalSede.js).
 * Concurrencia: OPERATIONAL_BULK_CONCURRENCY (1–20, por defecto 3).
 */
export const createOperationalUsersBulk = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'Archivo faltante',
        message: 'Debe adjuntar un archivo Excel en el campo "file".',
      });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    if (!sheet) {
      return res.status(400).json({
        error: 'Archivo inválido',
        message: 'El archivo Excel no contiene hojas.',
      });
    }

    const { rows, firstDataExcelRow } = parseOperationalBulkSheet(sheet);

    if (!rows.length) {
      return res.status(400).json({
        error: 'Sin datos',
        message: 'El archivo no contiene filas de datos.',
      });
    }

    const rowJobs = rows.map((row, index) => ({
      row,
      rowNumber: index + firstDataExcelRow,
    }));
    const bulkReservedUpnLower = new Set();
    const limit = getOperationalBulkConcurrency();
    const results = await mapWithConcurrency(rowJobs, limit, ({ row, rowNumber }) =>
      processOperationalBulkRow(row, rowNumber, bulkReservedUpnLower)
    );

    res.status(201).json({
      message: 'Procesamiento masivo completado.',
      results,
    });
  } catch (error) {
    logGraphApiError('carga masiva operativos', error);
    res.status(500).json({
      error: 'Error interno',
      message: error.message || 'Error al procesar el archivo de usuarios.',
    });
  }
};
