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
  // Primera opción: nombre.apellido1
  let localPart = generateLocalPart(givenName, surname1);
  let userPrincipalName = `${localPart}@${DOMAIN}`;
  
  const exists1 = await userExists(graphClient, userPrincipalName);
  
  if (!exists1) {
    return { localPart, userPrincipalName };
  }

  // Segunda opción: nombre.apellido2 (si existe segundo apellido)
  if (surname2 && surname2.trim()) {
    localPart = generateLocalPart(givenName, surname2);
    userPrincipalName = `${localPart}@${DOMAIN}`;
    
    const exists2 = await userExists(graphClient, userPrincipalName);
    
    if (!exists2) {
      return { localPart, userPrincipalName };
    }
  }

  // Si ambas opciones existen, usar sufijo numérico incremental
  let counter = 1;
  let baseLocalPart = surname2 && surname2.trim() 
    ? generateLocalPart(givenName, surname2)
    : generateLocalPart(givenName, surname1);
  
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
 * Crea un usuario en Microsoft 365
 */
export const createUserInMicrosoft365 = async ({ givenName, surname1, surname2, jobTitle, department }) => {
  const graphClient = getGraphClient();

  // Generar displayName
  const displayName = `${givenName.trim()} ${surname1.trim()}`.trim();

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
