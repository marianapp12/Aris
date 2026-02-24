import { createUserInMicrosoft365 } from '../services/graphUserService.js';

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
