import { getGraphClient } from '../config/graphClient.js';
import {
  pickFirstAvailableSamAndUpnForOperational,
  NO_UPN_CANDIDATES_EXHAUSTED,
} from './graphUpnCandidatePicker.js';

const OPERATIONAL_UPN_DOMAIN =
  process.env.OPERATIONAL_UPN_DOMAIN?.trim() ||
  'realizandoprueba123hotmail.onmicrosoft.com';

const INITIAL_PASSWORD = 'Aris1234*';

/** Límites típicos Microsoft Graph (recurso user). */
const GRAPH_SURNAME_MAX = 64;
const GRAPH_CITY_MAX = 128;

function truncateForGraphField(value, maxLen) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen).trimEnd();
}

/** Evita condición de carrera en carga masiva: solo una creación (pick UPN + POST) a la vez. */
let graphUserCreateChain = Promise.resolve();

/**
 * @template T
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
function enqueueGraphUserCreate(task) {
  const run = graphUserCreateChain.then(() => task());
  graphUserCreateChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * @param {Set<string> | undefined} bulkReservedUpnLower - UPN en minúsculas ya reservados en la misma carga masiva.
 */
const generateUniqueUserPrincipalName = async (
  graphClient,
  givenName,
  surname1,
  surname2,
  bulkReservedUpnLower
) => {
  try {
    const { samAccountName, userPrincipalName } = await pickFirstAvailableSamAndUpnForOperational(
      graphClient,
      {
        givenName,
        surname1,
        surname2: surname2?.trim() || '',
        emailDomain: OPERATIONAL_UPN_DOMAIN,
        ...(bulkReservedUpnLower ? { bulkReservedUpnLower } : {}),
      }
    );
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
 * Usa la misma lógica que createUserInMicrosoft365 (candidatos operativos M365 + Graph).
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
 * Cuerpo serializado: pick UPN + POST (y un reintento en 409 con nuevo UPN).
 */
async function createUserInMicrosoft365Serialized({
  givenName,
  surname1,
  surname2,
  jobTitle,
  department,
  postalCode,
  city,
  bulkReservedUpnLower,
}) {
  const graphClient = getGraphClient();

  const fullSurname = [surname1, surname2]
    .map((v) => v && v.trim())
    .filter(Boolean)
    .join(' ');
  const surnameForGraph = truncateForGraphField(fullSurname, GRAPH_SURNAME_MAX);
  const displayName = `${givenName.trim()} ${fullSurname}`.trim();
  const cityForGraph = city ? truncateForGraphField(city, GRAPH_CITY_MAX) : '';

  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { localPart, userPrincipalName } = await generateUniqueUserPrincipalName(
      graphClient,
      givenName,
      surname1,
      surname2,
      bulkReservedUpnLower
    );

    const newUser = {
      accountEnabled: true,
      displayName: displayName,
      mailNickname: localPart,
      userPrincipalName: userPrincipalName,
      givenName: givenName.trim(),
      surname: surnameForGraph,
      passwordProfile: {
        password: INITIAL_PASSWORD,
        forceChangePasswordNextSignIn: true,
      },
      jobTitle: jobTitle,
      department: department,
      ...(postalCode ? { postalCode } : {}),
      ...(cityForGraph ? { city: cityForGraph } : {}),
    };

    try {
      const createdUser = await graphClient.api('/users').post(newUser);
      const finalUpn = String(createdUser.userPrincipalName || userPrincipalName || '').trim();
      if (finalUpn && createdUser.id) {
        try {
          await graphClient.api(`/users/${createdUser.id}`).patch({
            otherMails: [finalUpn],
          });
        } catch (patchErr) {
          console.warn(
            '[Graph] No se pudo actualizar otherMails tras crear usuario operativo (el UPN sigue siendo el inicio de sesión):',
            patchErr?.message || patchErr
          );
        }
      }
      return {
        id: createdUser.id,
        userPrincipalName: createdUser.userPrincipalName,
        displayName: createdUser.displayName,
      };
    } catch (error) {
      lastError = error;
      const isConflict = error.statusCode === 409;
      if (isConflict && attempt === 0) {
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

/**
 * Crea un usuario en Microsoft 365 (cola interna: evita UPN duplicado por paralelismo en bulk).
 */
export const createUserInMicrosoft365 = async (params) => {
  return enqueueGraphUserCreate(() => createUserInMicrosoft365Serialized(params));
};
