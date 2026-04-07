import fs from 'fs/promises';
import XLSX from 'xlsx';
import {
  validateAdministrativePayload,
  normalizeAdministrativePostalCode,
} from '../utils/administrativeUserValidation.js';
import { normalizeAdministrativeBody } from '../utils/administrativeUserNormalization.js';
import {
  getAdQueueConfig,
  getAdQueueResultsPath,
  joinAdQueueFilePath,
} from '../config/adQueueConfig.js';
import {
  enqueueAdUserRequest,
  proposeAdministrativeUsername,
  testAdQueueUncWrite,
} from '../services/adQueueUserService.js';
import { AdministrativePrecheckError } from '../services/graphAdministrativePrecheck.js';
import { pickFirstAvailableSamAndUpnForAdQueue } from '../services/adLdapSamAccountPick.js';
import { parseAdministrativeBulkSheet } from '../utils/excelAdministrativeBulkParse.js';

const toTitleCase = (value) =>
  value
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const onlyLettersRegex = /[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s-]/;
const hasInvalidCharsForName = (value) => value && onlyLettersRegex.test(value);

/** Evita path traversal en nombres resultado-*.json (UUID v4 típico de la cola). */
const QUEUE_REQUEST_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/users y POST /api/users/administrative — 202 Accepted + requestId (cola SMB)
 */
export const createUserViaAdQueue = async (req, res) => {
  const validation = validateAdministrativePayload(req.body);
  if (!validation.ok) {
    return res.status(validation.status).json({
      error: validation.error,
      message: validation.message,
    });
  }

  try {
    const normalized = normalizeAdministrativeBody(req.body);
    const result = await enqueueAdUserRequest(normalized);

    return res.status(202).json({
      requestId: result.requestId,
      message:
        'Solicitud encolada. El usuario se creará en Active Directory cuando el servidor procese el archivo; puede tardar varios minutos (sincronización con Microsoft 365 vía Azure AD Connect).',
      queuePath: result.queuePath,
      proposedUserName: result.samAccountName ?? undefined,
      userPrincipalName: result.userPrincipalName ?? undefined,
      displayName: result.displayName,
      queueAction: result.queueAction ?? 'create',
    });
  } catch (error) {
    if (error instanceof AdministrativePrecheckError) {
      return res.status(error.httpStatus).json({
        error:
          error.code === 'EMPLOYEE_ID_IN_USE'
            ? 'Cédula ya registrada en Microsoft 365'
            : error.code === 'EMPLOYEE_ID_IN_USE_AD'
              ? 'Cédula ya registrada en Active Directory'
              : error.code === 'EMPLOYEE_ID_PENDING_IN_QUEUE'
                ? 'Cédula con solicitud ya en cola'
                : error.code === 'EMPLOYEE_ID_IN_PROCESSED_RECORDS'
                  ? 'Usuario ya registrado en Active Directory (procesados)'
                  : error.code === 'EMPLOYEE_ID_AMBIGUOUS'
                    ? 'Cédula / ID ambigua en el directorio'
                    : error.code === 'AD_LDAP_UNAVAILABLE'
                      ? 'No se pudo consultar Active Directory (LDAP)'
                      : error.code === 'NO_UPN_AVAILABLE'
                        ? 'Sin nombre de cuenta disponible (UPN / alias); colisión técnica, no cédula'
                        : 'Prechequeo antes de encolar',
        message: error.message,
        code: error.code,
      });
    }

    const msg = error?.message || String(error);
    if (msg.includes('Falta la variable de entorno AD_QUEUE_')) {
      return res.status(503).json({
        error: 'Configuración de cola AD incompleta',
        message: msg,
      });
    }
    console.error('[AD-Queue] Error al encolar creación administrativa:', msg);
    return res.status(500).json({
      error: 'Error interno',
      message:
        process.env.NODE_ENV === 'development' ? msg : 'No se pudo escribir la solicitud en la cola AD',
    });
  }
};

/** Alias para compatibilidad con clientes que llaman POST /api/users/administrative */
export const createAdministrativeUser = createUserViaAdQueue;

/**
 * GET /api/users/administrative/queue-connection-test — prueba escritura SMB en AD_QUEUE_UNC
 */
export const testAdQueueConnection = async (req, res) => {
  const result = await testAdQueueUncWrite();
  return res.status(200).json(result);
};

/**
 * GET /api/users/administrative/next-username — candidato libre en AD (LDAP) o primer candidato si skip / sin LDAP
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

    const config = getAdQueueConfig();
    if (!config.emailDomain) {
      return res.status(503).json({
        error: 'Configuración de cola AD incompleta',
        message: 'Falta la variable de entorno AD_QUEUE_EMAIL_DOMAIN',
      });
    }

    if (config.skipGraphPrecheck) {
      const { sAMAccountName, userPrincipalName } = proposeAdministrativeUsername(
        givenName,
        surname1,
        surname2 || undefined
      );
      return res.json({
        userName: sAMAccountName,
        userPrincipalName,
      });
    }

    const picked = await pickFirstAvailableSamAndUpnForAdQueue({
      givenName,
      surname1,
      surname2: surname2 || undefined,
      emailDomain: config.emailDomain,
    });

    return res.json({
      userName: picked.samAccountName,
      userPrincipalName: picked.userPrincipalName,
    });
  } catch (error) {
    if (error instanceof AdministrativePrecheckError) {
      return res.status(error.httpStatus).json({
        error:
          error.code === 'NO_UPN_AVAILABLE'
            ? 'Sin nombre de cuenta disponible (UPN / alias); colisión técnica, no cédula'
            : error.code === 'AD_LDAP_UNAVAILABLE'
              ? 'No se pudo consultar Active Directory (LDAP)'
              : 'Prechequeo cola administrativa',
        message: error.message,
        code: error.code,
      });
    }

    const msg = error?.message || String(error);
    if (msg.includes('Falta la variable de entorno AD_QUEUE_')) {
      return res.status(503).json({
        error: 'Configuración de cola AD incompleta',
        message: msg,
      });
    }
    console.error('[AD-Queue] next-username administrativo:', msg);
    return res.status(500).json({
      error: 'Error interno',
      message:
        process.env.NODE_ENV === 'development'
          ? msg
          : 'No se pudo obtener el nombre de usuario sugerido',
    });
  }
};

/**
 * POST /api/users/administrative/bulk
 * Carga masiva: misma plantilla que operativos + Cedula (obligatoria), Codigo postal (obligatorio) y Ciudad (opcional).
 * Soporta (1) fila 1 título + fila 2 encabezados + datos desde fila 3, o (2) fila 1 encabezados + datos desde fila 2.
 * Encabezados admiten variantes (espacios, mayúsculas, tildes; sinónimos como Documento → cédula, CP/ZIP → código postal).
 */
export const createAdministrativeUsersBulk = async (req, res) => {
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

    const { rows, firstDataExcelRow } = parseAdministrativeBulkSheet(sheet);

    if (!rows.length) {
      return res.status(400).json({
        error: 'Sin datos',
        message: 'El archivo no contiene filas de datos.',
      });
    }

    const results = [];
    const seenEmployeeIds = new Set();

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const rowNumber = index + firstDataExcelRow;

      const primerNombre = (row.PrimerNombre || '').toString().trim();
      const segundoNombre = (row.SegundoNombre || '').toString().trim();
      const primerApellido = (row.PrimerApellido || '').toString().trim();
      const segundoApellido = (row.SegundoApellido || '').toString().trim();
      const puesto = (row.Puesto || '').toString().trim();
      const departamento = (row.Departamento || '').toString().trim();
      const cedulaRaw = (row.Cedula || '').toString().trim();
      const ciudad = (row.Ciudad || '').toString().trim();
      const codigoPostalRaw = (row.CodigoPostal ?? '').toString();

      if (
        !primerNombre ||
        !primerApellido ||
        !puesto ||
        !departamento ||
        !cedulaRaw ||
        !normalizeAdministrativePostalCode(codigoPostalRaw)
      ) {
        results.push({
          row: rowNumber,
          status: 'error',
          message:
            'Faltan campos obligatorios (PrimerNombre, PrimerApellido, Puesto, Departamento, Cedula, Codigo postal).',
        });
        continue;
      }

      if (primerNombre.length < 3 || primerApellido.length < 3) {
        results.push({
          row: rowNumber,
          status: 'error',
          message: 'PrimerNombre y PrimerApellido deben tener al menos 3 caracteres.',
        });
        continue;
      }

      const maxLength = 50;
      if (
        primerNombre.length > maxLength ||
        primerApellido.length > maxLength ||
        (segundoNombre && segundoNombre.length > maxLength) ||
        (segundoApellido && segundoApellido.length > maxLength) ||
        puesto.length > maxLength ||
        departamento.length > maxLength
      ) {
        results.push({
          row: rowNumber,
          status: 'error',
          message: `Los campos no pueden exceder ${maxLength} caracteres.`,
        });
        continue;
      }

      if (hasInvalidCharsForName(primerNombre)) {
        results.push({ row: rowNumber, status: 'error', message: 'PrimerNombre: solo se permiten letras.' });
        continue;
      }
      if (segundoNombre && hasInvalidCharsForName(segundoNombre)) {
        results.push({ row: rowNumber, status: 'error', message: 'SegundoNombre: solo se permiten letras.' });
        continue;
      }
      if (hasInvalidCharsForName(primerApellido)) {
        results.push({ row: rowNumber, status: 'error', message: 'PrimerApellido: solo se permiten letras.' });
        continue;
      }
      if (segundoApellido && hasInvalidCharsForName(segundoApellido)) {
        results.push({ row: rowNumber, status: 'error', message: 'SegundoApellido: solo se permiten letras.' });
        continue;
      }

      const employeeId = cedulaRaw;
      if (seenEmployeeIds.has(employeeId)) {
        results.push({
          row: rowNumber,
          status: 'error',
          message: 'La cédula / ID está duplicada en este archivo (misma fila anterior).',
        });
        continue;
      }
      seenEmployeeIds.add(employeeId);

      const primerNombreNorm = toTitleCase(primerNombre);
      const segundoNombreNorm = segundoNombre ? toTitleCase(segundoNombre) : '';
      const primerApellidoNorm = toTitleCase(primerApellido);
      const segundoApellidoNorm = segundoApellido ? toTitleCase(segundoApellido) : '';
      const puestoNorm = puesto.toUpperCase();
      const departamentoNorm = departamento.toUpperCase();
      const givenName = [primerNombreNorm, segundoNombreNorm].filter(Boolean).join(' ');

      const body = {
        givenName,
        surname1: primerApellidoNorm,
        surname2: segundoApellidoNorm || undefined,
        jobTitle: puestoNorm,
        department: departamentoNorm,
        employeeId,
        postalCode: codigoPostalRaw,
        ...(ciudad ? { city: ciudad } : {}),
      };

      const validation = validateAdministrativePayload(body);
      if (!validation.ok) {
        results.push({
          row: rowNumber,
          status: 'error',
          message: validation.message,
        });
        continue;
      }

      try {
        const normalized = normalizeAdministrativeBody(body);
        const created = await enqueueAdUserRequest(normalized);
        results.push({
          row: rowNumber,
          status: 'success',
          requestId: created.requestId,
          userPrincipalName: created.userPrincipalName,
          displayName: created.displayName,
          proposedUserName: created.samAccountName,
          queueAction: created.queueAction ?? 'create',
        });
      } catch (error) {
        if (error instanceof AdministrativePrecheckError) {
          results.push({
            row: rowNumber,
            status: 'error',
            message: error.message,
            code: error.code,
          });
          continue;
        }
        const msg = error?.message || String(error);
        results.push({
          row: rowNumber,
          status: 'error',
          message: msg,
        });
      }
    }

    return res.status(201).json({
      message: 'Procesamiento masivo administrativo completado.',
      results,
    });
  } catch (error) {
    const msg = error?.message || String(error);
    console.error('[AD-Queue] carga masiva administrativa:', msg);
    return res.status(500).json({
      error: 'Error interno',
      message: msg || 'Error al procesar el archivo de usuarios.',
    });
  }
};

/**
 * GET /api/users/administrative/queue-requests/:requestId/result
 * Lee resultado-{requestId}.json (carpeta resultados del UNC). Expone al front el mismo estado
 * que escribió PowerShell: en éxito, samAccountName / userPrincipalName / email definitivos en AD.
 */
export const getAdministrativeQueueRequestResult = async (req, res) => {
  const requestId = String(req.params.requestId || '').trim();
  if (!QUEUE_REQUEST_ID_RE.test(requestId)) {
    return res.status(400).json({
      error: 'Solicitud inválida',
      message: 'El identificador de solicitud no tiene un formato válido.',
    });
  }

  const resultsRoot = getAdQueueResultsPath();
  if (!resultsRoot) {
    return res.status(503).json({
      error: 'Configuración incompleta',
      message:
        'Configure AD_QUEUE_UNC (o AD_QUEUE_RESULTS_UNC) para consultar el resultado del procesamiento en Active Directory.',
    });
  }

  const filePath = joinAdQueueFilePath(resultsRoot, `resultado-${requestId}.json`);

  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const rawClean = raw.replace(/^\uFEFF/, '').trim();
    let data;
    try {
      data = JSON.parse(rawClean);
    } catch (parseErr) {
      const hint = parseErr?.message || String(parseErr);
      return res.status(500).json({
        error: 'Resultado inválido',
        message: `El archivo de resultado no es JSON válido: ${hint}`,
      });
    }
    const rawStatus = data.status ?? data.Status;
    const st =
      rawStatus === 'success' || rawStatus === 'error' ? rawStatus : 'error';
    const rawMessage = data.message ?? data.Message;
    const message =
      typeof rawMessage === 'string' ? rawMessage : 'Respuesta sin mensaje descriptivo.';
    const processedAt = data.processedAt ?? data.ProcessedAt;
    const queueAction = data.queueAction ?? data.QueueAction;
    const samAccountName = data.samAccountName ?? data.SamAccountName;
    // Valores definitivos en AD (el script puede cambiar sAM/UPN respecto al JSON pendiente)
    const userPrincipalName = data.userPrincipalName ?? data.UserPrincipalName;
    const emailFromFile =
      data.email ?? data.Email ?? data.mail ?? data.Mail;
    return res.status(200).json({
      status: st,
      message,
      requestId: (data.requestId ?? data.RequestId) ?? requestId,
      processedAt: processedAt || undefined,
      queueAction: queueAction || undefined,
      samAccountName: samAccountName || undefined,
      userPrincipalName:
        typeof userPrincipalName === 'string' && userPrincipalName.trim()
          ? userPrincipalName.trim()
          : undefined,
      email:
        typeof emailFromFile === 'string' && emailFromFile.trim()
          ? emailFromFile.trim()
          : undefined,
    });
  } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) {
      return res.status(200).json({
        status: 'pending',
        message:
          'Aún no hay resultado: el script de Active Directory no ha procesado esta solicitud o el archivo no existe.',
        requestId,
      });
    }
    const msg = e?.message || String(e);
    console.error('[AD-Queue] leer resultado:', msg);
    const isAccess =
      e && (e.code === 'EACCES' || e.code === 'EPERM' || e.code === 'EBUSY');
    const detail = isAccess
      ? `${msg} Compruebe que la cuenta del proceso Node puede leer la carpeta configurada en AD_QUEUE_RESULTS_UNC (o resultados bajo AD_QUEUE_UNC).`
      : msg;
    return res.status(500).json({
      error: 'Error al leer resultado',
      message: detail,
    });
  }
};
