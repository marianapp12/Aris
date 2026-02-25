import { createUserInMicrosoft365, getNextAvailableUsername } from '../services/graphUserService.js';
import XLSX from 'xlsx';

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
 * Controlador para crear un usuario operativo
 */
export const createOperationalUser = async (req, res, next) => {
  try {
    const { givenName, surname1, surname2, jobTitle, department } = req.body;

    // Validación de campos obligatorios
    if (!givenName || !surname1 || !jobTitle || !department) {
      return res.status(400).json({
        error: 'Campos obligatorios faltantes',
        message: 'Los campos nombre, primer apellido, puesto y departamento son obligatorios',
      });
    }

    // Validación de longitud mínima
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

    // Respuesta exitosa
    res.status(201).json({
      id: result.id,
      userPrincipalName: result.userPrincipalName,
      displayName: result.displayName,
      email: result.userPrincipalName, // El userPrincipalName ya incluye el dominio
      message: 'Usuario creado exitosamente en Microsoft 365',
    });
  } catch (error) {
    console.error('Error al crear usuario operativo:', error);

    // Manejo de errores específicos de Microsoft Graph
    if (error.statusCode === 409) {
      return res.status(409).json({
        error: 'Usuario ya existe',
        message: 'Ya existe un usuario con ese nombre de usuario en Microsoft 365',
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
        message: 'Se requieren givenName y surname1 con al menos 3 caracteres',
      });
    }

    const result = await getNextAvailableUsername({ givenName, surname1, surname2 });
    res.json(result);
  } catch (error) {
    console.error('Error al obtener siguiente usuario:', error);
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
 * El archivo debe tener:
 *  - Fila 1: título (ej. "ARIS MINING") – se ignora
 *  - Fila 2: encabezados exactos:
 *      PrimerNombre | SegundoNombre | PrimerApellido | SegundoApellido | Puesto | Departamento
 *  - Fila 3+: datos
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

    // range: 1 → ignora la primera fila (título) y usa la segunda como encabezados
    const rows = XLSX.utils.sheet_to_json(sheet, { range: 1 });

    if (!rows.length) {
      return res.status(400).json({
        error: 'Sin datos',
        message: 'El archivo no contiene filas de datos.',
      });
    }

    const results = [];

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const rowNumber = index + 3; // datos comienzan en la fila 3

      const primerNombre = (row.PrimerNombre || '').toString().trim();
      const segundoNombre = (row.SegundoNombre || '').toString().trim();
      const primerApellido = (row.PrimerApellido || '').toString().trim();
      const segundoApellido = (row.SegundoApellido || '').toString().trim();
      const puesto = (row.Puesto || '').toString().trim();
      const departamento = (row.Departamento || '').toString().trim();

      // Validación mínima por fila
      if (!primerNombre || !primerApellido || !puesto || !departamento) {
        results.push({
          row: rowNumber,
          status: 'error',
          message:
            'Faltan campos obligatorios (PrimerNombre, PrimerApellido, Puesto, Departamento).',
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

      // Validación: solo letras en nombres y apellidos (igual que formulario individual)
      if (hasInvalidCharsForName(primerNombre)) {
        results.push({
          row: rowNumber,
          status: 'error',
          message: 'PrimerNombre: solo se permiten letras.',
        });
        continue;
      }
      if (segundoNombre && hasInvalidCharsForName(segundoNombre)) {
        results.push({
          row: rowNumber,
          status: 'error',
          message: 'SegundoNombre: solo se permiten letras.',
        });
        continue;
      }
      if (hasInvalidCharsForName(primerApellido)) {
        results.push({
          row: rowNumber,
          status: 'error',
          message: 'PrimerApellido: solo se permiten letras.',
        });
        continue;
      }
      if (segundoApellido && hasInvalidCharsForName(segundoApellido)) {
        results.push({
          row: rowNumber,
          status: 'error',
          message: 'SegundoApellido: solo se permiten letras.',
        });
        continue;
      }

      // Normalización igual que formulario individual: Title Case nombres/apellidos, MAYÚSCULAS puesto/departamento
      const primerNombreNorm = toTitleCase(primerNombre);
      const segundoNombreNorm = segundoNombre ? toTitleCase(segundoNombre) : '';
      const primerApellidoNorm = toTitleCase(primerApellido);
      const segundoApellidoNorm = segundoApellido ? toTitleCase(segundoApellido) : '';
      const puestoNorm = puesto.toUpperCase();
      const departamentoNorm = departamento.toUpperCase();

      const givenName = [primerNombreNorm, segundoNombreNorm].filter(Boolean).join(' ');

      try {
        const created = await createUserInMicrosoft365({
          givenName,
          surname1: primerApellidoNorm,
          surname2: segundoApellidoNorm || undefined,
          jobTitle: puestoNorm,
          department: departamentoNorm,
        });

        results.push({
          row: rowNumber,
          status: 'success',
          id: created.id,
          userPrincipalName: created.userPrincipalName,
          displayName: created.displayName,
        });
      } catch (error) {
        results.push({
          row: rowNumber,
          status: 'error',
          message: error.message || 'Error al crear el usuario en Microsoft 365.',
        });
      }
    }

    res.status(201).json({
      message: 'Procesamiento masivo completado.',
      results,
    });
  } catch (error) {
    console.error('Error en carga masiva de usuarios:', error);
    res.status(500).json({
      error: 'Error interno',
      message: error.message || 'Error al procesar el archivo de usuarios.',
    });
  }
};
