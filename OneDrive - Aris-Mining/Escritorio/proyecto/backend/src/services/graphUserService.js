import { getGraphClient } from '../config/graphClient.js';
import {
  pickFirstAvailableSamAndUpn,
  NO_UPN_CANDIDATES_EXHAUSTED,
} from './graphUpnCandidatePicker.js';

const OPERATIONAL_UPN_DOMAIN =
  process.env.OPERATIONAL_UPN_DOMAIN?.trim() ||
  'realizandoprueba123hotmail.onmicrosoft.com';

const INITIAL_PASSWORD = 'Aris1234*';

const generateUniqueUserPrincipalName = async (graphClient, givenName, surname1, surname2) => {
  try {
    const { samAccountName, userPrincipalName } = await pickFirstAvailableSamAndUpn(graphClient, {
      givenName,
      surname1,
      surname2: surname2?.trim() || '',
      emailDomain: OPERATIONAL_UPN_DOMAIN,
    });
    return { localPart: samAccountName, userPrincipalName };
  } catch (err) {
    if (err?.code === NO_UPN_CANDIDATES_EXHAUSTED) {
      throw new Error('No se pudo generar un nombre de usuario único después de múltiples intentos');
    }
    throw err;
  }
};

/**
 * Obtiene el siguiente nombre de usuario disponible (sin crear el usuario).
 * Usa la misma lógica que createUserInMicrosoft365 (iterateLocalPartCandidates + disponibilidad UPN/mailNickname en Graph).
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

  const fullSurname = [surname1, surname2]
    .map((v) => v && v.trim())
    .filter(Boolean)
    .join(' ');
  const displayName = `${givenName.trim()} ${fullSurname}`.trim();

  const { localPart, userPrincipalName } = await generateUniqueUserPrincipalName(
    graphClient,
    givenName,
    surname1,
    surname2
  );

  const newUser = {
    accountEnabled: true,
    displayName: displayName,
    mailNickname: localPart,
    userPrincipalName: userPrincipalName,
    givenName: givenName.trim(),
    surname: surname1.trim(),
    passwordProfile: {
      password: INITIAL_PASSWORD,
      forceChangePasswordNextSignIn: true,
    },
    jobTitle: jobTitle,
    department: department,
  };

  try {
    const createdUser = await graphClient.api('/users').post(newUser);

    return {
      id: createdUser.id,
      userPrincipalName: createdUser.userPrincipalName,
      displayName: createdUser.displayName,
    };
  } catch (error) {
    if (error.statusCode) {
      error.statusCode = error.statusCode;
    }
    throw error;
  }
};
