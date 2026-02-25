import { getGraphClient } from '../config/graphClient.js';

const DOMAIN = 'mariana28napgmail.onmicrosoft.com';
const INITIAL_PASSWORD = 'Aris1234*';

/**q
 * Normaliza un nombre para usarlo en la generación de userName
 */
const normalizeName = (name) => {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Elimina acentos
    .replace(/[^a-z0-9]/g, '') // Elimina caracteres especiales
    .trim();
};

/**
 * Genera el nombre de usuario (localPart) basado en nombre y apellido
 */
const generateLocalPart = (givenName, surname) => {
  const normalizedGivenName = normalizeName(givenName);
  const normalizedSurname = normalizeName(surname);
  
  if (!normalizedGivenName || !normalizedSurname) {
    throw new Error('No se puede generar el nombre de usuario: nombre o apellido inválido');
  }
  
  return `${normalizedGivenName}.${normalizedSurname}`;
};

/**
 * Verifica si un usuario ya existe en Microsoft 365
 */
const userExists = async (graphClient, userPrincipalName) => {
  try {
    const response = await graphClient
      .api(`/users?$filter=userPrincipalName eq '${userPrincipalName}'`)
      .get();
    
    return response.value && response.value.length > 0;
  } catch (error) {
    // Si hay error al verificar, asumimos que no existe para continuar
    console.warn(`Advertencia al verificar usuario ${userPrincipalName}:`, error.message);
    return false;
  }
};

/**
 * Genera un userPrincipalName único
 */
const generateUniqueUserPrincipalName = async (graphClient, givenName, surname1, surname2) => {
  const nameParts = givenName.trim().split(/\s+/).filter(Boolean);
  const primaryGivenName = nameParts[0] || givenName;
  const secondaryGivenName = nameParts[1] || null;

  // 1) Primera opción: primerNombre.apellido1
  let localPart = generateLocalPart(primaryGivenName, surname1);
  let userPrincipalName = `${localPart}@${DOMAIN}`;

  if (!(await userExists(graphClient, userPrincipalName))) {
    return { localPart, userPrincipalName };
  }

  // 2) Segunda opción: primerNombre.apellido2 (si existe segundo apellido)
  if (surname2 && surname2.trim()) {
    localPart = generateLocalPart(primaryGivenName, surname2);
    userPrincipalName = `${localPart}@${DOMAIN}`;

    if (!(await userExists(graphClient, userPrincipalName))) {
      return { localPart, userPrincipalName };
    }
  }

  // 3) Tercera opción: segundoNombre.apellido1 (si existe segundo nombre)
  if (secondaryGivenName) {
    localPart = generateLocalPart(secondaryGivenName, surname1);
    userPrincipalName = `${localPart}@${DOMAIN}`;

    if (!(await userExists(graphClient, userPrincipalName))) {
      return { localPart, userPrincipalName };
    }
  }

  // 4) Cuarta opción: segundoNombre.apellido2 (si existe segundo nombre y segundo apellido)
  if (secondaryGivenName && surname2 && surname2.trim()) {
    localPart = generateLocalPart(secondaryGivenName, surname2);
    userPrincipalName = `${localPart}@${DOMAIN}`;

    if (!(await userExists(graphClient, userPrincipalName))) {
      return { localPart, userPrincipalName };
    }
  }

  // 5) Si todas las opciones existen, usar sufijo numérico incremental sobre primerNombre.apellido1
  let counter = 1;
  const baseLocalPart = generateLocalPart(primaryGivenName, surname1);

  while (counter < 100) { // Límite de seguridad
    localPart = `${baseLocalPart}.${counter}`;
    userPrincipalName = `${localPart}@${DOMAIN}`;

    const exists = await userExists(graphClient, userPrincipalName);
    if (!exists) {
      return { localPart, userPrincipalName };
    }

    counter++;
  }

  throw new Error('No se pudo generar un nombre de usuario único después de múltiples intentos');
};

/**
 * Obtiene el siguiente nombre de usuario disponible (sin crear el usuario).
 * Usa la misma lógica que createUserInMicrosoft365 para garantizar coincidencia.
 */
export const getNextAvailableUsername = async ({ givenName, surname1, surname2 }) => {
  const graphClient = getGraphClient();
  const { localPart, userPrincipalName } = await generateUniqueUserPrincipalName(
    graphClient,
    givenName.trim(),
    surname1.trim(),
    surname2?.trim() || ''
  );
  return { userName: localPart, userPrincipalName };
};

/**
 * Crea un usuario en Microsoft 365
 */
export const createUserInMicrosoft365 = async ({ givenName, surname1, surname2, jobTitle, department }) => {
  const graphClient = getGraphClient();

  // Generar displayName con ambos apellidos si existen
  const fullSurname = [surname1, surname2]
    .map((v) => v && v.trim())
    .filter(Boolean)
    .join(' ');
  const displayName = `${givenName.trim()} ${fullSurname}`.trim();

  // Generar userPrincipalName único
  const { localPart, userPrincipalName } = await generateUniqueUserPrincipalName(
    graphClient,
    givenName,
    surname1,
    surname2
  );

  // Construir el objeto de usuario para Microsoft Graph
  const newUser = {
    accountEnabled: true,
    displayName: displayName,
    mailNickname: localPart,
    userPrincipalName: userPrincipalName,
    givenName: givenName.trim(),
    surname: surname1.trim(), // Microsoft Graph usa 'surname' para el apellido principal
    passwordProfile: {
      password: INITIAL_PASSWORD,
      forceChangePasswordNextSignIn: true,
    },
    jobTitle: jobTitle,
    department: department,
    // No se asignan licencias - el usuario se crea sin licencias por defecto
  };

  try {
    // Crear el usuario en Microsoft 365
    const createdUser = await graphClient
      .api('/users')
      .post(newUser);

    return {
      id: createdUser.id,
      userPrincipalName: createdUser.userPrincipalName,
      displayName: createdUser.displayName,
    };
  } catch (error) {
    // Mejorar el mensaje de error
    if (error.statusCode) {
      error.statusCode = error.statusCode;
    }
    throw error;
  }
};
