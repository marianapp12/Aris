import { useState, useEffect, useRef, type ReactNode } from 'react';
import {
  UserFormData,
  AdQueueRequestResult,
  OPERATIONAL_SEDE_OPTIONS,
  type AdministrativeBulkRowResult,
  type OperationalGroupMembershipResult,
} from '../types/user';
import { isAdScriptDuplicateEmployeeIdMessage } from '../utils/adQueueScriptMessages';
import {
  createOperationalUser,
  createUserViaAdQueue,
  getAdministrativeQueueRequestResult,
  testAdministrativeQueueConnection,
  uploadBulkUsers,
  uploadAdministrativeBulkUsers,
} from '../services/apiClient';
import {
  ADMINISTRATIVE_CITY_SELECT_OPTIONS,
  isAdministrativeCityFormValue,
} from '../constants/administrativeCities';
import './CreateUserForm.css';

/**
 * Formulario de creación de usuarios:
 * - Operativo: envío al backend → Microsoft Graph (cuenta M365).
 * - Administrativo: prueba SMB (opcional) → encolado JSON → script PowerShell en el servidor (AD).
 * Incluye validación en cliente, filtrado de entrada, carga masiva Excel y polling del resultado AD.
 */

function plantillaHrefFromEnv(
  envUrl: string | undefined,
  publicRelativeFile: string
): string {
  const u = envUrl?.trim();
  if (u && /^https?:\/\//i.test(u)) return u;
  return `${import.meta.env.BASE_URL}${publicRelativeFile}`;
}

function plantillaDownloadLinkProps(
  href: string,
  downloadFileName: string
): { download?: string; target?: '_blank'; rel?: string } {
  if (/^https?:\/\//i.test(href)) {
    return { target: '_blank', rel: 'noopener noreferrer' };
  }
  return { download: downloadFileName };
}

const PLANTILLA_OPERARIOS_HREF = plantillaHrefFromEnv(
  import.meta.env.VITE_PLANTILLA_OPERARIOS_URL,
  'plantilla-operarios.xlsx'
);
const PLANTILLA_ADMINISTRATIVOS_HREF = plantillaHrefFromEnv(
  import.meta.env.VITE_PLANTILLA_ADMINISTRATIVOS_URL,
  'plantilla-administrativos.xlsx'
);

function plantillaOrigenNote(
  href: string,
  kind: 'operational' | 'administrative'
): ReactNode {
  const remoto = /^https?:\/\//i.test(href);
  const envVarName =
    kind === 'operational'
      ? 'VITE_PLANTILLA_OPERARIOS_URL'
      : 'VITE_PLANTILLA_ADMINISTRATIVOS_URL';

  if (remoto) {
    return (
      <div
        className="plantilla-remoto-callout"
        role="region"
        aria-label="Instrucciones para obtener la plantilla desde SharePoint"
      >
        <div className="plantilla-remoto-callout__title">Plantilla en línea (SharePoint)</div>
        <p className="plantilla-remoto-callout__lead">
          Este botón abre la plantilla en <strong>SharePoint</strong> o en <strong>Excel en el navegador</strong>.
        </p>
        <ol className="plantilla-remoto-callout__list">
          <li>
            Si se le solicita acceso, inicie sesión en <strong>Microsoft 365</strong> en este navegador y
            pulse de nuevo el botón <strong>Descargar plantilla</strong>.
          </li>
          <li>
            Cuando vea la vista previa del libro, abra el menú <strong>Archivo</strong> y elija{' '}
            <strong>Crear una copia</strong> o <strong>Descargar</strong> (o la opción equivalente que muestre
            su pantalla) para guardar una copia en su equipo.
          </li>
          <li>
            Trabaje <strong>siempre</strong> sobre esa copia local: complete los datos, guarde el archivo y
            súbalo a esta aplicación con el botón <strong>Elegir archivo</strong>.
          </li>
        </ol>
        <p className="plantilla-remoto-callout__footer">
          De ese modo conserva el diseño de la plantilla publicada en la nube y no sobrescribe el original
          compartido.
        </p>
      </div>
    );
  }

  return (
    <p className="note" style={{ marginTop: 8, marginBottom: 0 }}>
      Ahora se usa la plantilla incluida en la web. Para que todos descarguen <strong>siempre</strong> la
      misma plantilla con diseño desde <strong>SharePoint</strong>, defina <code>{envVarName}</code> en{' '}
      <code>frontend/.env</code> (URL que empiece por <code>https://</code>) y reinicie el frontend; véase{' '}
      <code>frontend/.env.example</code> y el README del proyecto.
    </p>
  );
}

/** Alineado con backend (administrativeUserValidation). */
const EMPLOYEE_ID_MIN = 5;
const EMPLOYEE_ID_MAX = 32;

/** Alineado con operationalUsersController (código postal operativo). */
const OPERATIONAL_POSTAL_MIN = 4;
const OPERATIONAL_POSTAL_MAX = 10;

/** Alineado con operationalUsersController / bulk (máx. 50). */
const NAME_AND_JOB_MAX = 50;

const NON_NAME_CHARS = /[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s-]/g;
const NON_EMPLOYEE_ID_CHARS = /[^0-9A-Za-z-]/g;

/**
 * Filtra entrada en vivo: solo caracteres permitidos y longitud máxima por campo
 * (coherente con validateField y backend).
 */
function sanitizeFormFieldInput(name: keyof UserFormData, raw: string): string {
  switch (name) {
    case 'primerNombre':
    case 'segundoNombre':
    case 'apellido1':
    case 'apellido2':
      return raw.replace(NON_NAME_CHARS, '').slice(0, NAME_AND_JOB_MAX);
    case 'puesto':
    case 'departamento':
      return raw.replace(NON_NAME_CHARS, '').slice(0, NAME_AND_JOB_MAX);
    case 'cedula':
      return raw.replace(NON_EMPLOYEE_ID_CHARS, '').slice(0, EMPLOYEE_ID_MAX);
    case 'postalCode':
      return raw.replace(/\s/g, '').replace(/\D/g, '').slice(0, OPERATIONAL_POSTAL_MAX);
    case 'ciudad':
      return raw;
    default:
      return raw;
  }
}

/** Etiquetas legibles para el resumen de validación (modal). */
const FORM_FIELD_LABELS: Record<keyof UserFormData, string> = {
  primerNombre: 'Primer nombre',
  segundoNombre: 'Segundo nombre',
  apellido1: 'Primer apellido',
  apellido2: 'Segundo apellido',
  puesto: 'Puesto',
  departamento: 'Departamento',
  sede: 'Sede',
  postalCode: 'Código postal',
  cedula: 'Cédula / ID',
  ciudad: 'Ciudad / sede',
};

/** Sufijo en etiquetas de campos obligatorios (sustituye el asterisco). */
const CAMPO_OBLIGATORIO = ' (campo Obligatorio)';

/** Misma contraseña inicial que graphUserService.js (operativos / Microsoft 365). */
export const INITIAL_PASSWORD_M365 = 'Aris1234*';

type UserCreationType = 'operational' | 'administrative';

/** Normaliza a formato título (primera letra mayúscula por palabra) para nombres en el payload. */
const toTitleCase = (value: string): string =>
  value
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

type CreatedUser = {
  displayName: string;
  userName: string;
  email: string;
  id?: string;
  requestId?: string;
  creationType: UserCreationType;
  /** Alta nueva en cola AD vs actualización de perfil (cédula ya en Graph). */
  adminQueueAction?: 'create' | 'updateByEmployeeId';
  /** Solo creación operativa individual. */
  sede?: string;
  groupObjectId?: string;
  groupMemberAdded?: boolean;
  groupMemberships?: OperationalGroupMembershipResult[];
  /** OU de destino en Active Directory (alta administrativa encolada). */
  adOrganizationalUnitDn?: string;
};

/** Valores de la respuesta 202 (propuesta) para comparar con el resultado confirmado en AD. */
type AdminEncoladoPropuesta = {
  displayName: string;
  userName: string;
  email: string;
};

function normAdIdentity(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Comprueba si la propuesta al encolar difiere de lo reportado en resultado-*.json (éxito en AD).
 */
function adminProposalDiffersFromAdResult(
  prop: AdminEncoladoPropuesta,
  r: AdQueueRequestResult
): boolean {
  if (r.status !== 'success') return false;
  if (r.displayName?.trim() && normAdIdentity(prop.displayName) !== normAdIdentity(r.displayName)) {
    return true;
  }
  const upn = (r.userPrincipalName || '').replace(/^—$/, '').trim();
  const propUpn = prop.email.replace(/^—$/, '').trim();
  if (upn && propUpn && normAdIdentity(propUpn) !== normAdIdentity(upn)) {
    return true;
  }
  const sam = (r.samAccountName || '').trim();
  const propSam = prop.userName.replace(/^—$/, '').trim();
  if (sam && propSam && normAdIdentity(propSam) !== normAdIdentity(sam)) {
    return true;
  }
  return false;
}

/** Resume un error de Graph (código + mensaje corto) para mostrar junto a una asignación de grupo M365. */
function formatGraphErrorSuffix(g: OperationalGroupMembershipResult['graphError']): string {
  if (!g) return '';
  const bits = [
    g.code,
    g.httpStatus != null ? `HTTP ${g.httpStatus}` : '',
    g.message ? g.message.slice(0, 160) : '',
  ].filter(Boolean);
  if (bits.length === 0) return '';
  return bits.join(' · ');
}

/**
 * Etiqueta legible para “grupo por sede” cuando el backend no envía `groupMemberships` (respuesta antigua).
 */
function operationalGroupAssignmentLabel(
  sede: string | undefined,
  groupObjectId: string | undefined,
  groupMemberAdded: boolean | undefined
): string {
  const place = sede?.trim() || '—';
  if (!groupObjectId) {
    return `${place} — no se configuró GROUP_* en el servidor`;
  }
  if (groupMemberAdded) {
    return `${place} — miembro agregado`;
  }
  return `${place} — no se pudo agregar (revise logs del backend)`;
}

/** Una fila de resultado: grupo sede o común, si se agregó el miembro y mensaje de error Graph si hubo fallo. */
function OperationalGroupMembershipCard({
  m,
  sedeName,
}: {
  m: OperationalGroupMembershipResult;
  sedeName: string | undefined;
}) {
  const place = sedeName?.trim() || '—';
  const groupName = m.groupDisplayName?.trim();
  const nameMatchesSede =
    m.kind === 'sede' &&
    groupName &&
    place !== '—' &&
    groupName.localeCompare(place, undefined, { sensitivity: 'accent' }) === 0;

  let primaryTitle = '';
  let subtitle = '';
  let errorText = '';

  if (m.kind === 'sede') {
    subtitle = 'Grupo según sede';
    if (!m.groupObjectId) {
      primaryTitle = place !== '—' ? `Sede ${place}` : 'Sede';
      errorText = 'No hay GROUP_* configurado en el servidor para esta sede.';
    } else if (nameMatchesSede) {
      primaryTitle = place;
      subtitle = 'Grupo de la sede (Microsoft 365)';
    } else if (groupName) {
      primaryTitle = groupName;
      subtitle = `Sede: ${place}`;
    } else {
      primaryTitle = `Sede ${place}`;
    }
    if (m.groupObjectId && !m.memberAdded) {
      errorText =
        (groupName && !nameMatchesSede ? `${groupName}: ` : '') +
        'No se pudo agregar al grupo' +
        (formatGraphErrorSuffix(m.graphError)
          ? ` (${formatGraphErrorSuffix(m.graphError)})`
          : '.');
    }
  } else {
    subtitle = 'Grupo común (todos los operarios)';
    if (!m.groupObjectId) {
      primaryTitle = 'Ranura sin grupo';
      errorText =
        'Falta Object ID en OPERATIONAL_COMMON_GROUP_IDS (revisar .env del servidor).';
    } else {
      primaryTitle = groupName || 'Grupo común';
    }
    if (m.groupObjectId && !m.memberAdded) {
      errorText =
        'No se pudo agregar' +
        (formatGraphErrorSuffix(m.graphError)
          ? ` (${formatGraphErrorSuffix(m.graphError)})`
          : '.');
    }
  }

  const ok = m.memberAdded && !!m.groupObjectId;

  return (
    <div
      className={`operational-group-card ${ok ? 'operational-group-card--ok' : errorText ? 'operational-group-card--err' : ''}`}
    >
      <div className="operational-group-card__main">
        <div className="operational-group-card__title">{primaryTitle}</div>
        <div className="operational-group-card__subtitle">{subtitle}</div>
        {errorText ? (
          <div className="operational-group-card__error">{errorText}</div>
        ) : null}
      </div>
      {m.groupObjectId ? (
        <span
          className={`operational-group-badge ${ok ? 'operational-group-badge--ok' : 'operational-group-badge--err'}`}
        >
          {ok ? 'Agregado' : 'Error'}
        </span>
      ) : (
        <span className="operational-group-badge operational-group-badge--warn">Pendiente</span>
      )}
    </div>
  );
}

function OperationalGroupAssignmentsBlock({
  memberships,
  sedeName,
  legacySede,
  legacyGroupObjectId,
  legacyGroupMemberAdded,
}: {
  memberships: OperationalGroupMembershipResult[] | undefined;
  sedeName: string | undefined;
  legacySede: string | undefined;
  legacyGroupObjectId: string | undefined;
  legacyGroupMemberAdded: boolean | undefined;
}) {
  const hasStructured = memberships && memberships.length > 0;
  const sedeItems = hasStructured
    ? memberships!.filter((x) => x.kind === 'sede')
    : [];
  const commonItems = hasStructured
    ? memberships!.filter((x) => x.kind === 'common')
    : [];

  return (
    <div className="success-row">
      <span className="success-label">ASIGNACIÓN A GRUPOS</span>
      <span className="success-value operational-groups-value">
        {hasStructured ? (
          <div className="operational-groups-panel">
            {sedeItems.length > 0 ? (
              <div className="operational-groups-section">
                <div className="operational-groups-section__title">Por sede</div>
                <div className="operational-groups-section__cards">
                  {sedeItems.map((m, i) => (
                    <OperationalGroupMembershipCard
                      key={`sede-${i}`}
                      m={m}
                      sedeName={sedeName}
                    />
                  ))}
                </div>
              </div>
            ) : null}
            {commonItems.length > 0 ? (
              <div className="operational-groups-section">
                <div className="operational-groups-section__title">Grupos comunes</div>
                <div className="operational-groups-section__cards">
                  {commonItems.map((m, i) => (
                    <OperationalGroupMembershipCard
                      key={`common-${i}`}
                      m={m}
                      sedeName={sedeName}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="operational-groups-panel">
            <div className="operational-group-card operational-group-card--legacy">
              <p className="operational-group-card__legacy-text">
                {operationalGroupAssignmentLabel(
                  legacySede,
                  legacyGroupObjectId,
                  legacyGroupMemberAdded
                )}
              </p>
            </div>
          </div>
        )}
      </span>
    </div>
  );
}

const SMB_QUEUE_HELP_STEPS: string[] = [
  'El navegador no escribe en la carpeta compartida: quien necesita acceso SMB es la máquina (o servidor) donde está ejecutándose el backend Node.',
  'Revise en el servidor que AD_QUEUE_UNC en el archivo .env del backend sea la ruta correcta (por ejemplo \\\\servidor\\carpeta\\pendiente) y, tras cualquier cambio, reinicie el proceso del backend. En esa misma PC con Windows, pulse Win + R, escriba la misma ruta UNC y pulse Enter; si pide credenciales, use un usuario de dominio o del servidor con permiso de escritura en el recurso compartido.',
  'Vuelva a pulsar “Probar conexión” cuando haya completado los pasos anteriores.',
];

/** Intervalo entre consultas a resultado-{requestId}.json (administrativo / AD). */
const AD_RESULT_POLL_MS = 1000;
/** Ventana total de polling automático antes de mostrar “Comprobar estado”. */
const AD_RESULT_MAX_POLLS = 300;
const AD_RESULT_POLL_WINDOW_MINUTES = Math.max(
  1,
  Math.round((AD_RESULT_MAX_POLLS * AD_RESULT_POLL_MS) / 60_000)
);
/** Máx. filas de carga masiva admin consultando resultado AD a la vez (GET por requestId). */
const BULK_AD_POLL_CONCURRENCY = 5;

/** Fila devuelta por POST .../bulk (operativo o administrativo). */
type BulkRowResult = {
  row: number;
  status: string;
  userPrincipalName?: string;
  displayName?: string;
  sede?: string;
  groupObjectId?: string;
  groupMemberAdded?: boolean;
  groupMemberships?: OperationalGroupMembershipResult[];
  message?: string;
  code?: string;
  requestId?: string;
  proposedUserName?: string;
  queueAction?: 'create' | 'updateByEmployeeId';
  adOrganizationalUnitDn?: string;
};

/**
 * Componente raíz del formulario: tipo de alta, campos, errores, masivos Excel y seguimiento de cola/resultado AD.
 */
const CreateUserForm = () => {
  const [userCreationType, setUserCreationType] =
    useState<UserCreationType>('operational');

  const [formData, setFormData] = useState<UserFormData>({
    primerNombre: '',
    segundoNombre: '',
    apellido1: '',
    apellido2: '',
    puesto: '',
    departamento: '',
    sede: '',
    postalCode: '',
    cedula: '',
    ciudad: '',
  });

  const [createdUser, setCreatedUser] = useState<CreatedUser | null>(null);

  const [errors, setErrors] = useState<Partial<Record<keyof UserFormData, string>>>({});
  /** Modal al fallar validación al enviar: lista de campos con error. */
  const [validationModalOpen, setValidationModalOpen] = useState(false);
  const [validationModalLines, setValidationModalLines] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkStatus, setBulkStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [bulkMessage, setBulkMessage] = useState<string>('');
  const [bulkResults, setBulkResults] = useState<BulkRowResult[] | null>(null);

  const [bulkAdminFile, setBulkAdminFile] = useState<File | null>(null);
  const [bulkAdminStatus, setBulkAdminStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [bulkAdminMessage, setBulkAdminMessage] = useState<string>('');
  const [bulkAdminResults, setBulkAdminResults] = useState<
    AdministrativeBulkRowResult[] | null
  >(null);

  const [queueConnStatus, setQueueConnStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(
    'idle'
  );
  const [queueConnDetail, setQueueConnDetail] = useState<{
    ok?: boolean;
    message?: string;
    uncPath?: string;
    code?: string;
  } | null>(null);

  const [adminSmbGatePassed, setAdminSmbGatePassed] = useState(false);
  /** Snapshot 202 (propuesta) solo alta administrativa; se compara con `adScriptResult` al confirmar. */
  const [adminEncoladoPropuesta, setAdminEncoladoPropuesta] =
    useState<AdminEncoladoPropuesta | null>(null);

  const [adScriptResult, setAdScriptResult] = useState<AdQueueRequestResult | null>(null);
  const [adScriptPollExhausted, setAdScriptPollExhausted] = useState(false);
  /** Último error al consultar resultado AD durante el polling (p. ej. 503 configuración). */
  const [adPollLastError, setAdPollLastError] = useState<string | null>(null);
  const [adManualCheckLoading, setAdManualCheckLoading] = useState(false);
  const adPollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Resultado de GET .../result por requestId (carga masiva admin); la clave es el requestId. */
  const [bulkAdResultByRequestId, setBulkAdResultByRequestId] = useState<
    Record<string, AdQueueRequestResult>
  >({});

  /**
   * Tras encolar administrativo: consulta periódicamente `resultado-{requestId}.json` vía API hasta success/error
   * o hasta agotar reintentos (UI invita a “Comprobar estado”).
   */
  useEffect(() => {
    if (
      status !== 'success' ||
      !createdUser?.requestId ||
      createdUser.creationType !== 'administrative'
    ) {
      return undefined;
    }

    const requestId = createdUser.requestId;
    let cancelled = false;
    let pollCount = 0;

    if (adPollTimeoutRef.current) {
      clearTimeout(adPollTimeoutRef.current);
      adPollTimeoutRef.current = null;
    }

    setAdScriptResult(null);
    setAdScriptPollExhausted(false);
    setAdPollLastError(null);

    async function tick() {
      if (cancelled) return;
      try {
        const r = await getAdministrativeQueueRequestResult(requestId);
        if (cancelled) return;
        if (r.status === 'success' || r.status === 'error') {
          setAdPollLastError(null);
          setAdScriptResult(r);
          setAdScriptPollExhausted(false);
          return;
        }
        setAdPollLastError(null);
      } catch (e) {
        setAdPollLastError(
          e instanceof Error ? e.message : 'Error al consultar el estado en Active Directory.'
        );
      }
      pollCount += 1;
      if (pollCount >= AD_RESULT_MAX_POLLS) {
        setAdScriptPollExhausted(true);
        return;
      }
      adPollTimeoutRef.current = setTimeout(tick, AD_RESULT_POLL_MS);
    }

    void tick();

    return () => {
      cancelled = true;
      if (adPollTimeoutRef.current) {
        clearTimeout(adPollTimeoutRef.current);
        adPollTimeoutRef.current = null;
      }
    };
  }, [status, createdUser?.requestId, createdUser?.creationType]);

  /**
   * El 202 al encolar trae UPN/usuario propuestos; PowerShell puede asignar otro sAM/UPN.
   * Cuando el polling recibe success con displayName / userPrincipalName / email del archivo
   * resultado-*.json, alineamos la tarjeta de éxito con lo que quedó en Active Directory.
   */
  useEffect(() => {
    if (!adScriptResult || adScriptResult.status !== 'success') return;
    if (createdUser?.creationType !== 'administrative') return;

    const upn = adScriptResult.userPrincipalName?.trim();
    const mail = adScriptResult.email?.trim();
    const emailDisplay = mail || upn;
    const sam = adScriptResult.samAccountName?.trim();
    const userNameFinal =
      sam ||
      (upn && upn.includes('@') ? upn.split('@')[0] : '') ||
      (emailDisplay && emailDisplay.includes('@')
        ? emailDisplay.split('@')[0]
        : '');
    const displayNameFinal = adScriptResult.displayName?.trim();

    if (!emailDisplay && !userNameFinal && !displayNameFinal) return;

    setCreatedUser((prev) => {
      if (!prev || prev.creationType !== 'administrative') return prev;
      const nextEmail = emailDisplay || prev.email;
      const nextUser = userNameFinal || prev.userName;
      const nextDisplay = displayNameFinal || prev.displayName;
      if (
        nextEmail === prev.email &&
        nextUser === prev.userName &&
        nextDisplay === prev.displayName
      ) {
        return prev;
      }
      return {
        ...prev,
        email: nextEmail,
        userName: nextUser,
        displayName: nextDisplay,
      };
    });
  }, [adScriptResult, createdUser?.creationType]);

  /**
   * Carga masiva admin: un worker pool consulta el resultado de AD por cada requestId encolado con éxito;
   * UPN, correo y sAM fiables solo existen al completar (igual que el flujo individual).
   */
  useEffect(() => {
    if (!bulkAdminResults) {
      setBulkAdResultByRequestId({});
      return undefined;
    }
    const hasSuccess = bulkAdminResults.some((r) => r.status === 'success' && r.requestId?.trim());
    if (!hasSuccess) {
      setBulkAdResultByRequestId({});
      return undefined;
    }
    const successIds = [
      ...new Set(
        bulkAdminResults
          .filter((r) => r.status === 'success' && r.requestId?.trim())
          .map((r) => r.requestId!.trim())
      ),
    ];
    if (successIds.length === 0) {
      return undefined;
    }

    setBulkAdResultByRequestId({});

    let cancelled = false;
    const idQueue = successIds.slice();

    const pollOne = async (requestId: string) => {
      let n = 0;
      while (!cancelled && n < AD_RESULT_MAX_POLLS) {
        try {
          const r = await getAdministrativeQueueRequestResult(requestId);
          if (cancelled) return;
          if (r.status === 'success' || r.status === 'error') {
            setBulkAdResultByRequestId((prev) => ({ ...prev, [requestId]: r }));
            return;
          }
          n += 1;
          await new Promise((res) => {
            setTimeout(res, AD_RESULT_POLL_MS);
          });
        } catch (err) {
          if (cancelled) return;
          const msg =
            err instanceof Error
              ? err.message
              : 'Error al consultar el resultado en Active Directory.';
          setBulkAdResultByRequestId((prev) => ({
            ...prev,
            [requestId]: {
              status: 'error',
              message: msg,
              requestId,
            } as AdQueueRequestResult,
          }));
          return;
        }
      }
      if (!cancelled) {
        setBulkAdResultByRequestId((prev) => ({
          ...prev,
          [requestId]: {
            status: 'error',
            message: `Tiempo de espera agotado (unos ${AD_RESULT_POLL_WINDOW_MINUTES} minutos) al consultar el resultado en Active Directory.`,
            requestId,
          } as AdQueueRequestResult,
        }));
      }
    };

    const nWorkers = Math.min(BULK_AD_POLL_CONCURRENCY, idQueue.length);
    const runWorker = async () => {
      while (!cancelled) {
        const requestId = idQueue.shift();
        if (!requestId) return;
        await pollOne(requestId);
      }
    };
    const workers = Array.from({ length: nWorkers }, () => runWorker());
    void Promise.all(workers);

    return () => {
      cancelled = true;
    };
  }, [bulkAdminResults]);

  /** Una consulta manual al resultado AD (botón “Comprobar estado”), sin depender del polling. */
  const handleRefreshAdScriptResult = async () => {
    if (!createdUser?.requestId || createdUser.creationType !== 'administrative') return;
    setAdManualCheckLoading(true);
    try {
      const r = await getAdministrativeQueueRequestResult(createdUser.requestId);
      if (r.status === 'success' || r.status === 'error') {
        setAdScriptResult(r);
        setAdScriptPollExhausted(false);
      }
    } catch (e) {
      setAdScriptResult({
        status: 'error',
        message:
          e instanceof Error ? e.message : 'No se pudo consultar el estado en Active Directory.',
        requestId: createdUser.requestId,
      });
    } finally {
      setAdManualCheckLoading(false);
    }
  };

  /**
   * Valida un campo según reglas alineadas al backend. @returns Mensaje de error o '' si es válido.
   */
  const validateField = (name: keyof UserFormData, value: string): string => {
    if (name === 'cedula') {
      const t = value.trim();
      if (!t) {
        return userCreationType === 'administrative' ? 'La cédula / ID es obligatoria' : '';
      }
      if (t.length < EMPLOYEE_ID_MIN || t.length > EMPLOYEE_ID_MAX) {
        return `La cédula / ID debe tener entre ${EMPLOYEE_ID_MIN} y ${EMPLOYEE_ID_MAX} caracteres`;
      }
      if (!/^[0-9A-Za-z-]+$/.test(t)) {
        return 'Solo alfanuméricos y guiones';
      }
      return '';
    }

    if (name === 'ciudad') {
      const t = value.trim();
      if (userCreationType === 'administrative') {
        if (!t) return 'Seleccione una sede';
        if (!isAdministrativeCityFormValue(t)) return 'Sede no válida';
      }
      return '';
    }

    if (name === 'postalCode') {
      const t = value.replace(/\s/g, '').trim();
      if (!t) {
        return 'El código postal es obligatorio';
      }
      if (
        !/^\d+$/.test(t) ||
        t.length < OPERATIONAL_POSTAL_MIN ||
        t.length > OPERATIONAL_POSTAL_MAX
      ) {
        return `Solo números, entre ${OPERATIONAL_POSTAL_MIN} y ${OPERATIONAL_POSTAL_MAX} dígitos`;
      }
      return '';
    }

    if (name === 'puesto' || name === 'departamento') {
      const t = value.trim();
      if (t.length < 3) return 'Debe tener al menos 3 caracteres';
      if (t.length > 50) return 'No puede exceder 50 caracteres';
      const invalidChars = /[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s-]/;
      if (invalidChars.test(t)) {
        return 'Solo se permiten letras, espacios y guiones';
      }
      return '';
    }

    if (value.length < 3) return 'Debe tener al menos 3 caracteres';
    if (value.length > 50) return 'No puede exceder 50 caracteres';

    if (
      name === 'primerNombre' ||
      name === 'segundoNombre' ||
      name === 'apellido1' ||
      name === 'apellido2'
    ) {
      const invalidChars = /[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s-]/;
      if (invalidChars.test(value)) return 'Solo se permiten letras';
    }
    return '';
  };

  /**
   * Valida todos los campos aplicables al tipo de alta, actualiza `errors` y devuelve si el formulario es válido.
   */
  const validateForm = (): {
    valid: boolean;
    errors: Partial<Record<keyof UserFormData, string>>;
  } => {
    const newErrors: Partial<Record<keyof UserFormData, string>> = {};

    const required: (keyof UserFormData)[] = [
      'primerNombre',
      'apellido1',
      'puesto',
      'departamento',
      'postalCode',
    ];
    if (userCreationType === 'administrative') {
      required.push('ciudad');
    }

    const allFields: (keyof UserFormData)[] = [
      'primerNombre',
      'segundoNombre',
      'apellido1',
      'apellido2',
      'puesto',
      'departamento',
      'postalCode',
      'sede',
      'cedula',
      'ciudad',
    ];

    allFields.forEach((field) => {
      const value = formData[field];

      if (field === 'sede') {
        if (userCreationType !== 'operational') return;
        if (!value.trim()) {
          newErrors.sede = 'Seleccione una sede';
          return;
        }
        if (
          !OPERATIONAL_SEDE_OPTIONS.includes(
            value as (typeof OPERATIONAL_SEDE_OPTIONS)[number]
          )
        ) {
          newErrors.sede = 'Sede no válida';
        }
        return;
      }

      if (field === 'cedula') {
        const error = validateField(field, value);
        if (error) newErrors[field] = error;
        return;
      }

      if (field === 'postalCode') {
        const error = validateField(field, value);
        if (error) newErrors[field] = error;
        return;
      }

      if (field === 'ciudad') {
        if (userCreationType !== 'administrative') return;
        const error = validateField(field, value);
        if (error) newErrors[field] = error;
        return;
      }

      if (!value.trim()) {
        if (required.includes(field)) {
          newErrors[field] = 'Este campo es obligatorio';
        }
        return;
      }

      const error = validateField(field, value);
      if (error) newErrors[field] = error;
    });

    setErrors(newErrors);
    const valid = Object.keys(newErrors).length === 0;
    return { valid, errors: newErrors };
  };

  /**
   * Cambio de input/select: en inputs aplica `sanitizeFormFieldInput`; limpia error del campo y resetea estado de envío si aplica.
   */
  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    const key = name as keyof UserFormData;
    const nextValue =
      e.target instanceof HTMLSelectElement
        ? value
        : sanitizeFormFieldInput(key, value);

    setFormData((prev) => ({ ...prev, [name]: nextValue }));

    if (errors[name as keyof UserFormData]) {
      setErrors((prev) => {
        const copy = { ...prev };
        delete copy[name as keyof UserFormData];
        return copy;
      });
    }

    if (status !== 'idle') {
      setStatus('idle');
      setErrorMessage('');
    }
  };

  const handleBulkFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setBulkFile(file);
    setBulkMessage('');
    setBulkStatus('idle');
  };

  /** POST masivo operativos: Excel → API; guarda `bulkResults` con estado por fila. */
  const handleBulkUpload = async () => {
    if (!bulkFile) {
      setBulkMessage('Por favor selecciona un archivo de Excel.');
      setBulkStatus('error');
      return;
    }

    try {
      setBulkStatus('loading');
      setBulkMessage('');
      setBulkResults(null);

      const result = await uploadBulkUsers(bulkFile);

      const resultsArray = (
        Array.isArray(result.results) ? result.results : []
      ) as BulkRowResult[];
      const successCount = resultsArray.filter((r) => r.status === 'success').length;
      const errorCount = resultsArray.filter((r) => r.status === 'error').length;

      setBulkStatus('done');
      setBulkMessage(
        successCount === 0 && errorCount > 0
          ? `Ningún usuario creado (${errorCount} fila(s) con error). Abajo verá el motivo por fila.`
          : errorCount > 0
            ? `Resumen: ${successCount} creado(s), ${errorCount} con error (detalle en la lista).`
            : `Carga completada: ${successCount} usuario(s) creado(s) en Microsoft 365.`
      );
      setBulkResults(resultsArray);
    } catch (err) {
      setBulkStatus('error');
      setBulkMessage(
        err instanceof Error ? err.message : 'Error al cargar el archivo de usuarios.'
      );
      setBulkResults(null);
    }
  };

  const handleBulkAdminFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setBulkAdminFile(file);
    setBulkAdminMessage('');
    setBulkAdminStatus('idle');
  };

  /** POST masivo administrativos: Excel → encolado por fila; resultados en `bulkAdminResults`. */
  const handleBulkAdminUpload = async () => {
    if (!bulkAdminFile) {
      setBulkAdminMessage('Por favor selecciona un archivo de Excel.');
      setBulkAdminStatus('error');
      return;
    }

    try {
      setBulkAdminStatus('loading');
      setBulkAdminMessage('');
      setBulkAdminResults(null);

      const result = await uploadAdministrativeBulkUsers(bulkAdminFile);
      const resultsArray = (
        Array.isArray(result.results) ? result.results : []
      ) as BulkRowResult[];
      const successCount = resultsArray.filter((r) => r.status === 'success').length;
      const errorCount = resultsArray.filter((r) => r.status === 'error').length;

      setBulkAdminStatus('done');
      setBulkAdminMessage(
        successCount === 0 && errorCount > 0
          ? `Ninguna solicitud encolada (${errorCount} fila(s) rechazada(s)). Abajo verá el motivo por fila.`
          : errorCount > 0
            ? `Resumen: ${successCount} encolada(s), ${errorCount} con error (detalle en la lista).`
            : `Carga completada: ${successCount} solicitud(es) encolada(s).`
      );
      setBulkAdminResults(resultsArray);
    } catch (err) {
      setBulkAdminStatus('error');
      setBulkAdminMessage(
        err instanceof Error ? err.message : 'Error al cargar el archivo de usuarios administrativos.'
      );
      setBulkAdminResults(null);
    }
  };

  /** Prueba escritura en UNC de cola; si OK activa `adminSmbGatePassed` y desbloquea el formulario administrativo. */
  const handleTestQueueConnection = async () => {
    setQueueConnStatus('loading');
    setQueueConnDetail(null);
    try {
      const data = await testAdministrativeQueueConnection();
      setQueueConnDetail(data);
      setQueueConnStatus(data.ok ? 'success' : 'error');
      setAdminSmbGatePassed(!!data.ok);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'No se pudo contactar al servidor o la respuesta no es válida.';
      setQueueConnDetail({
        ok: false,
        message: msg,
      });
      setQueueConnStatus('error');
      setAdminSmbGatePassed(false);
    }
  };

  /**
   * Envío: `createOperationalUser` (M365) o `createUserViaAdQueue` (JSON en carpeta); éxito → `createdUser` y UI de resultado.
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { valid, errors: nextErrors } = validateForm();
    if (!valid) {
      const lines = (Object.entries(nextErrors) as [keyof UserFormData, string][]).map(
        ([key, msg]) => `${FORM_FIELD_LABELS[key]}: ${msg}`
      );
      setValidationModalLines(lines);
      setValidationModalOpen(true);
      return;
    }

    setStatus('loading');

    try {
      const rawPrimerNombre = formData.primerNombre.trim();
      const rawSegundoNombre = formData.segundoNombre.trim();
      const rawApellido1 = formData.apellido1.trim();
      const rawApellido2 = formData.apellido2.trim();
      const rawPuesto = formData.puesto.trim();
      const rawDepartamento = formData.departamento.trim();

      const primerNombreNorm = toTitleCase(rawPrimerNombre);
      const segundoNombreNorm = rawSegundoNombre ? toTitleCase(rawSegundoNombre) : '';
      const apellido1Norm = toTitleCase(rawApellido1);
      const apellido2Norm = rawApellido2 ? toTitleCase(rawApellido2) : '';

      const puestoNorm = rawPuesto.toUpperCase();
      const departamentoNorm = rawDepartamento.toUpperCase();

      const displayGivenName = [primerNombreNorm, segundoNombreNorm]
        .filter(Boolean)
        .join(' ');

      const payload = {
        givenName: displayGivenName,
        surname1: apellido1Norm,
        surname2: apellido2Norm || undefined,
        jobTitle: puestoNorm,
        department: departamentoNorm,
        ...(userCreationType === 'operational'
          ? {
              sede: formData.sede.trim(),
              postalCode: formData.postalCode.replace(/\s/g, '').trim(),
            }
          : {}),
        ...(userCreationType === 'administrative'
          ? {
              employeeId: formData.cedula.trim(),
              city: formData.ciudad.trim(),
              postalCode: formData.postalCode.replace(/\s/g, '').trim(),
            }
          : {}),
      };

      if (userCreationType === 'operational') {
        const response = await createOperationalUser(payload);
        const principal = response.userPrincipalName || response.email;
        const displayName = response.displayName;
        const email = principal;
        const userName = principal.split('@')[0];

        setCreatedUser({
          displayName,
          userName,
          email,
          id: response?.id,
          creationType: 'operational',
          sede: response.sede,
          groupObjectId: response.groupObjectId,
          groupMemberAdded: response.groupMemberAdded,
          groupMemberships: response.groupMemberships,
        });
        setStatus('success');
      } else {
        const accepted = await createUserViaAdQueue(payload);
        const upn = accepted.userPrincipalName ?? '';
        const localPart = upn.includes('@') ? upn.split('@')[0] : '';
        const resolvedUserName = accepted.proposedUserName ?? (localPart || '—');
        setAdminEncoladoPropuesta({
          displayName: accepted.displayName,
          userName: resolvedUserName,
          email: upn || '—',
        });
        setCreatedUser({
          displayName: accepted.displayName,
          userName: resolvedUserName,
          email: upn || '—',
          requestId: accepted.requestId,
          creationType: 'administrative',
          adminQueueAction: accepted.queueAction ?? 'create',
          adOrganizationalUnitDn: accepted.adOrganizationalUnitDn,
        });
        setStatus('success');
      }
    } catch (err) {
      setStatus('error');
      setErrorMessage(
        err instanceof Error ? err.message : 'Error al crear el usuario'
      );
    }
  };

  /** Limpia formulario, resultados masivos, cola AD y timers para dar de alta otro usuario. */
  const handleCreateAnother = () => {
    if (adPollTimeoutRef.current) {
      clearTimeout(adPollTimeoutRef.current);
      adPollTimeoutRef.current = null;
    }
    setAdScriptResult(null);
    setAdScriptPollExhausted(false);
    setAdManualCheckLoading(false);
    setAdminEncoladoPropuesta(null);
    setCreatedUser(null);
    setStatus('idle');
    setErrorMessage('');
    setAdPollLastError(null);
    setBulkResults(null);
    setBulkAdminResults(null);
    setBulkAdminFile(null);
    setBulkAdminStatus('idle');
    setBulkAdminMessage('');
    setAdminSmbGatePassed(false);
    setQueueConnStatus('idle');
    setQueueConnDetail(null);
    setFormData({
      primerNombre: '',
      segundoNombre: '',
      apellido1: '',
      apellido2: '',
      puesto: '',
      departamento: '',
      sede: '',
      postalCode: '',
      cedula: '',
      ciudad: '',
    });
  };

  /**
   * Carga masiva administrativa sin ningún encolado: el backend sí devuelve `message` por fila,
   * pero antes no había pantalla dedicada (solo el resumen en el formulario).
   */
  if (
    bulkAdminResults &&
    bulkAdminResults.length > 0 &&
    !bulkAdminResults.some((r) => r.status === 'success')
  ) {
    const failed = bulkAdminResults.filter((r) => r.status === 'error');
    const rows = failed.length > 0 ? failed : bulkAdminResults;

    return (
      <div className="success-wrapper">
        <div className="success-card bulk-admin-report-card">
          <div className="bulk-admin-report-icon bulk-admin-report-icon--warn" aria-hidden>
            !
          </div>

          <h2 className="success-title">Ninguna solicitud encolada</h2>

          <p className="success-subtitle">
            Se procesaron {rows.length} fila(s) del Excel y ninguna pasó la validación o el
            prechequeo para escribir en la cola. Revise el motivo de cada fila, corrija el archivo y
            vuelva a cargar.
          </p>

          <h3 className="bulk-admin-section-heading">Detalle por fila del Excel</h3>
          <div className="bulk-admin-table-scroll">
            <div className="bulk-admin-grid bulk-admin-grid--head" role="row">
              <span>Fila</span>
              <span>Motivo</span>
              <span>Código</span>
            </div>
            {rows.map((u, index) => (
              <div
                className="bulk-admin-grid bulk-admin-grid--row"
                key={`admin-bulk-all-err-${index}`}
                role="row"
              >
                <span className="bulk-admin-cell-fila">{u.row}</span>
                <span className="bulk-admin-cell-msg">
                  {u.message || 'Error al encolar la solicitud.'}
                </span>
                <span className="bulk-admin-cell-code">
                  {u.code?.trim() || '—'}
                </span>
              </div>
            ))}
          </div>

          <div className="success-note">
            Causas frecuentes: cédula ya registrada en Microsoft 365 o en la carpeta de procesados,
            duplicado en archivos pendientes, o fallo al escribir en la ruta SMB del servidor.
          </div>

          <button
            type="button"
            className="primary-btn"
            onClick={() => {
              setBulkAdminResults(null);
              setBulkAdminFile(null);
              setBulkAdminStatus('idle');
              setBulkAdminMessage('');
              setAdminSmbGatePassed(false);
              setQueueConnStatus('idle');
              setQueueConnDetail(null);
            }}
          >
            Volver al formulario
          </button>
        </div>
      </div>
    );
  }

  // Vista de éxito para carga masiva administrativa (cola AD) — al menos una fila encolada
  if (bulkAdminResults && bulkAdminResults.some((r) => r.status === 'success')) {
    const created = bulkAdminResults.filter((r) => r.status === 'success');
    const failed = bulkAdminResults.filter((r) => r.status === 'error');
    const bulkCreates = created.filter((r) => r.queueAction !== 'updateByEmployeeId');
    const bulkUpdates = created.filter((r) => r.queueAction === 'updateByEmployeeId');

    const encoladoPendienteAd = created.filter((u) => {
      const rid = u.requestId?.trim();
      if (!rid) return true;
      const r = bulkAdResultByRequestId[rid];
      return r == null;
    }).length;

    return (
      <div className="success-wrapper">
        <div className="success-card">
          <div className="success-icon">✓</div>

          <h2 className="success-title">Solicitudes administrativas encoladas</h2>

          <p className="success-subtitle">
            {bulkCreates.length > 0 && (
              <>
                {bulkCreates.length} alta(s) nueva(s) en cola para Active Directory.{' '}
              </>
            )}
            {bulkUpdates.length > 0 && (
              <>
                {bulkUpdates.length} actualización(es) de perfil (cédula ya existente en Microsoft
                365).{' '}
              </>
            )}
            Archivos JSON en la carpeta compartida. El <strong>UPN, correo y usuario (sAM)</strong>{' '}
            de cada fila se rellenan <strong>cuando el script confirma</strong> el resultado en el
            directorio (mismo criterio que el alta individual).{' '}
            {encoladoPendienteAd > 0
              ? `Consultando en el servidor la confirmación de Active Directory para ${encoladoPendienteAd} solicitud(es)…`
              : 'Consulta a resultados de AD finalizada.'}
          </p>

          <h3 className="bulk-admin-section-heading">Solicitudes encoladas correctamente</h3>
          <div className="bulk-admin-success-list">
          {created.map((u) => {
            const rid = u.requestId?.trim();
            const adRes = rid ? bulkAdResultByRequestId[rid] : undefined;
            const adOk = adRes?.status === 'success';
            const adMail =
              adRes &&
              adOk &&
              adRes.email?.trim() &&
              adRes.userPrincipalName?.trim() &&
              normAdIdentity(adRes.email) !== normAdIdentity(adRes.userPrincipalName)
                ? adRes.email.trim()
                : null;
            const adUpnStr = adOk ? adRes.userPrincipalName?.trim() || '' : '';
            const adSam = adOk ? adRes.samAccountName?.trim() || '' : '';

            return (
              <div
                className="bulk-admin-row-card"
                key={rid || `row-${u.row}`}
              >
                <div className="bulk-admin-row-card__head">
                  <span className="bulk-admin-row-card__filabadge">Fila {u.row}</span>
                  <span
                    className={
                      u.queueAction === 'updateByEmployeeId'
                        ? 'bulk-admin-row-card__type bulk-admin-row-card__type--update'
                        : 'bulk-admin-row-card__type bulk-admin-row-card__type--create'
                    }
                  >
                    {u.queueAction === 'updateByEmployeeId'
                      ? 'Actualización de perfil'
                      : 'Alta nueva'}
                  </span>
                </div>
                <div className="bulk-admin-row-card__meta">
                  <div className="bulk-admin-meta-item">
                    <span className="bulk-admin-meta-item__label">Solicitud</span>
                    <code className="bulk-admin-meta-item__value">{u.requestId ?? '—'}</code>
                  </div>
                  {u.adOrganizationalUnitDn?.trim() ? (
                    <div className="bulk-admin-meta-item bulk-admin-meta-item--wide">
                      <span className="bulk-admin-meta-item__label">OU</span>
                      <code className="bulk-admin-meta-item__value bulk-admin-meta-item__value--dn">
                        {u.adOrganizationalUnitDn.trim()}
                      </code>
                    </div>
                  ) : null}
                </div>

                {adRes == null ? (
                  <div className="bulk-ad-pending">
                    <span className="bulk-ad-pending__icon" aria-hidden>
                      ⏳
                    </span>
                    <p className="bulk-ad-pending__text">
                      Consultando en Active Directory… El bloque de abajo se rellenará con los datos
                      definitivos al confirmar el script.
                    </p>
                  </div>
                ) : null}
                {adRes?.status === 'error' ? (
                  isAdScriptDuplicateEmployeeIdMessage(adRes.message) ? (
                    <div className="bulk-admin-bulk-ad-err">
                      <p className="error-text" style={{ marginTop: 0, marginBottom: 6 }}>
                        <strong>Cédula duplicada en Active Directory (fila {u.row}).</strong>
                      </p>
                      <p className="error-text" style={{ marginTop: 0 }}>{adRes.message}</p>
                    </div>
                  ) : (
                    <p className="error-text bulk-admin-err-line">
                      <strong>Resultado en AD (fila {u.row}):</strong> {adRes.message}
                    </p>
                  )
                ) : null}
                {adOk && adRes ? (
                  <div className="bulk-ad-saved-block">
                    <p className="admin-ad-section-h3 bulk-ad-saved-title">
                      Como quedó guardado en el directorio
                    </p>
                    <div
                      className="success-table bulk-ad-saved-confirm"
                      role="table"
                      aria-label="Valores en Active Directory"
                    >
                      <div className="success-row" role="row">
                        <span className="success-label" role="rowheader">
                          Nombre
                        </span>
                        <span className="success-value" role="cell">
                          {adRes.displayName?.trim() || '—'}
                        </span>
                      </div>
                      {adUpnStr ? (
                        <div className="success-row" role="row">
                          <span className="success-label" role="rowheader">
                            UPN
                          </span>
                          <span className="success-value highlight" role="cell">
                            {adUpnStr}
                          </span>
                        </div>
                      ) : null}
                      {adMail ? (
                        <div className="success-row" role="row">
                          <span className="success-label" role="rowheader">
                            Correo (mail)
                          </span>
                          <span className="success-value highlight" role="cell">
                            {adMail}
                          </span>
                        </div>
                      ) : null}
                      {adSam ? (
                        <div className="success-row" role="row">
                          <span className="success-label" role="rowheader">
                            Usuario (sAM)
                          </span>
                          <span className="success-value mono" role="cell">
                            {adSam}
                          </span>
                        </div>
                      ) : null}
                    </div>
                    {adRes.processedAt ? (
                      <p className="note bulk-ad-saved-foot">
                        Procesado:{' '}
                        <span className="bulk-ad-saved-timestamp">{adRes.processedAt}</span>
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          </div>

          {failed.length > 0 && (
            <>
              <h3 className="bulk-admin-section-heading">
                Registros con error ({failed.length})
              </h3>
              <div className="bulk-admin-table-scroll">
                <div className="bulk-admin-grid bulk-admin-grid--head" role="row">
                  <span>Fila</span>
                  <span>Motivo</span>
                  <span>Código</span>
                </div>
                {failed.map((u, index) => (
                  <div
                    className="bulk-admin-grid bulk-admin-grid--row"
                    key={`admin-bulk-err-${index}`}
                    role="row"
                  >
                    <span className="bulk-admin-cell-fila">{u.row}</span>
                    <span className="bulk-admin-cell-msg">
                      {u.message || 'Error al encolar la solicitud.'}
                    </span>
                    <span className="bulk-admin-cell-code">
                      {u.code?.trim() || '—'}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="success-note">
            La contraseña y la creación final en Active Directory las aplica el script en el
            servidor. Cada <strong>tabla “Como quedó guardado en el directorio”</strong> se rellena al
            confirmarse el procesamiento. Revise la carpeta <code>error</code> en el share si una fila
            falla tras el envío.
          </div>

          <button
            type="button"
            className="primary-btn"
            onClick={() => {
              setBulkAdResultByRequestId({});
              setBulkAdminResults(null);
              setBulkAdminFile(null);
              setBulkAdminStatus('idle');
              setBulkAdminMessage('');
              setAdminSmbGatePassed(false);
              setQueueConnStatus('idle');
              setQueueConnDetail(null);
            }}
          >
            Volver al formulario
          </button>
        </div>
      </div>
    );
  }

  /** Carga masiva operativa: todas las filas fallaron — mismo problema que administrativa (detalle oculto). */
  if (
    bulkResults &&
    bulkResults.length > 0 &&
    !bulkResults.some((r) => r.status === 'success')
  ) {
    const failed = bulkResults.filter((r) => r.status === 'error');
    const rows = failed.length > 0 ? failed : bulkResults;

    return (
      <div className="success-wrapper">
        <div className="success-card bulk-admin-report-card">
          <div className="bulk-admin-report-icon bulk-admin-report-icon--warn" aria-hidden>
            !
          </div>

          <h2 className="success-title">Ningún usuario creado</h2>

          <p className="success-subtitle">
            Se procesaron {rows.length} fila(s) y ninguna pudo crearse en Microsoft 365. Revise el
            motivo de cada fila.
          </p>

          <h3 className="bulk-admin-section-heading">Detalle por fila del Excel</h3>
          <div className="bulk-admin-table-scroll">
            <div className="bulk-admin-grid bulk-admin-grid--head" role="row">
              <span>Fila</span>
              <span>Motivo</span>
              <span>Código</span>
            </div>
            {rows.map((u, index) => (
              <div
                className="bulk-admin-grid bulk-admin-grid--row"
                key={`op-bulk-all-err-${index}`}
                role="row"
              >
                <span className="bulk-admin-cell-fila">{u.row}</span>
                <span className="bulk-admin-cell-msg">
                  {u.message || 'Error al crear el usuario.'}
                </span>
                <span className="bulk-admin-cell-code">
                  {u.code?.trim() || '—'}
                </span>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="primary-btn"
            onClick={() => {
              setBulkResults(null);
              setBulkFile(null);
              setBulkStatus('idle');
              setBulkMessage('');
            }}
          >
            Volver al formulario
          </button>
        </div>
      </div>
    );
  }

  // Vista de éxito para carga masiva de usuarios operativos (al menos uno creado)
  if (bulkResults && bulkResults.some((r) => r.status === 'success')) {
    const created = bulkResults.filter((r) => r.status === 'success');
    const failed = bulkResults.filter((r) => r.status === 'error');

    return (
      <div className="success-wrapper">
        <div className="success-card">
          <div className="success-icon">✓</div>

          <h2 className="success-title">
            Usuarios creados exitosamente
          </h2>

          <p className="success-subtitle">
            Se han creado {created.length} usuario(s) en Microsoft 365.
          </p>

          <h3 className="bulk-admin-section-heading">Usuarios creados</h3>
          {created.map((u, index) => (
            <div className="bulk-admin-result-group" key={`success-${index}`}>
              <div className="bulk-admin-result-group-title">
                Fila {u.row} — Usuario {index + 1}
              </div>
              <div className="success-table">
                <div className="success-row">
                  <span className="success-label">NOMBRE COMPLETO</span>
                  <span className="success-value">{u.displayName ?? '—'}</span>
                </div>
                <div className="success-row">
                  <span className="success-label">UPN / CORREO</span>
                  <span className="success-value highlight">
                    {u.userPrincipalName ?? '—'}
                  </span>
                </div>
                <div className="success-row">
                  <span className="success-label">SEDE</span>
                  <span className="success-value">{u.sede?.trim() || '—'}</span>
                </div>
                <OperationalGroupAssignmentsBlock
                  memberships={u.groupMemberships}
                  sedeName={u.sede}
                  legacySede={u.sede}
                  legacyGroupObjectId={u.groupObjectId}
                  legacyGroupMemberAdded={u.groupMemberAdded}
                />
              </div>
            </div>
          ))}

          {failed.length > 0 && (
            <>
              <h3 className="bulk-admin-section-heading">
                Registros con error ({failed.length})
              </h3>
              <div className="bulk-admin-table-scroll">
                <div className="bulk-admin-grid bulk-admin-grid--head" role="row">
                  <span>Fila</span>
                  <span>Motivo</span>
                  <span>Código</span>
                </div>
                {failed.map((u, index) => (
                  <div
                    className="bulk-admin-grid bulk-admin-grid--row"
                    key={`error-${index}`}
                    role="row"
                  >
                    <span className="bulk-admin-cell-fila">{u.row}</span>
                    <span className="bulk-admin-cell-msg">
                      {u.message || 'Error al crear el usuario.'}
                    </span>
                    <span className="bulk-admin-cell-code">
                      {u.code?.trim() || '—'}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="success-note">
            <strong>Contraseña inicial ({INITIAL_PASSWORD_M365}):</strong> los usuarios deberán
            cambiarla al iniciar sesión en Microsoft 365.
          </div>

          <button
            type="button"
            className="primary-btn"
            onClick={() => {
              setBulkResults(null);
              setBulkFile(null);
              setBulkStatus('idle');
              setBulkMessage('');
            }}
          >
            Volver al formulario
          </button>
        </div>
      </div>
    );
  }

  // Vista de éxito para creación individual
  if (status === 'success' && createdUser) {
    const isAdminProfileUpdate =
      createdUser.creationType === 'administrative' &&
      createdUser.adminQueueAction === 'updateByEmployeeId';
    const adminAdIdentityConfirmed =
      createdUser.creationType === 'administrative' &&
      adScriptResult?.status === 'success';
    const isAdmin = createdUser.creationType === 'administrative';
    const adMismatch =
      isAdmin &&
      adminAdIdentityConfirmed &&
      adScriptResult &&
      adminEncoladoPropuesta &&
      adminProposalDiffersFromAdResult(adminEncoladoPropuesta, adScriptResult);
    const adUpn = adScriptResult?.userPrincipalName?.trim() || createdUser.email;
    const adDisplay =
      adScriptResult?.displayName?.trim() || createdUser.displayName;
    const adMail =
      adScriptResult?.email?.trim() && adScriptResult.userPrincipalName?.trim() &&
      normAdIdentity(adScriptResult.email) !==
        normAdIdentity(adScriptResult.userPrincipalName)
        ? adScriptResult.email.trim()
        : null;
    const adSam = adScriptResult?.samAccountName?.trim() || createdUser.userName;

    return (
      <div className="success-wrapper">
        <div className="success-card">

          <div className="success-icon">✓</div>

          <h2 className="success-title">
            {createdUser.creationType === 'administrative'
              ? isAdminProfileUpdate
                ? 'Actualización encolada'
                : 'Solicitud encolada'
              : 'Usuario creado exitosamente'}
          </h2>

          <p className="success-subtitle">
            {createdUser.creationType === 'administrative'
              ? adminAdIdentityConfirmed
                ? isAdminProfileUpdate
                  ? 'Solicitud procesada. Los valores de la sección “Valores en Active Directory” deben coincidir con el objeto en el directorio; Azure AD Connect puede tardar en reflejarlos en Microsoft 365.'
                  : 'El usuario se registró en Active Directory. Use la tabla de confirmación para verificar nombres, UPN y usuario frente a “Usuarios y equipos de AD”.'
                : isAdminProfileUpdate
                  ? 'La solicitud de actualización de datos se aplicará en Active Directory cuando el servidor procese el archivo; Azure AD Connect sincronizará los cambios con Microsoft 365 y puede tardar varios minutos.'
                  : 'La solicitud se guardó en la cola del servidor. Al procesarse, los datos finales (nombre, UPN, usuario) pueden diferir de la propuesta; se mostrarán al confirmar abajo.'
              : 'El usuario debe cambiar su contraseña en el primer inicio de sesión.'}
          </p>

          {createdUser.creationType === 'operational' && (
            <div className="success-table">
              <div className="success-row">
                <span className="success-label">NOMBRE COMPLETO</span>
                <span className="success-value">{createdUser.displayName}</span>
              </div>
              <div className="success-row">
                <span className="success-label">CORREO CORPORATIVO</span>
                <span className="success-value highlight">{createdUser.email}</span>
              </div>
              <div className="success-row">
                <span className="success-label">USUARIO</span>
                <span className="success-value">{createdUser.userName}</span>
              </div>
              <div className="success-row">
                <span className="success-label">SEDE</span>
                <span className="success-value">
                  {createdUser.sede?.trim() || '—'}
                </span>
              </div>
              <OperationalGroupAssignmentsBlock
                memberships={createdUser.groupMemberships}
                sedeName={createdUser.sede}
                legacySede={createdUser.sede}
                legacyGroupObjectId={createdUser.groupObjectId}
                legacyGroupMemberAdded={createdUser.groupMemberAdded}
              />
            </div>
          )}

          {isAdmin && adminAdIdentityConfirmed && adScriptResult ? (
            <>
              {adMismatch && (
                <div className="admin-ad-mismatch-callout" role="status">
                  <p className="admin-ad-mismatch-callout__title">Diferencia respecto a la propuesta al encolar</p>
                  <p className="admin-ad-mismatch-callout__text">
                    Lo mostrado al aceptar la cola (UPN, usuario o nombre) no coincide con lo
                    reportado ahora por Active Directory (por ejemplo, colisión de cuentas o reglas
                    en el script). <strong>Para validar, use solo la sección “Valores en Active
                    Directory”</strong> o el objeto de usuario en el directorio, no el primer
                    pantallazo.
                  </p>
                </div>
              )}
              <h3 className="admin-ad-section-h3">Valores en Active Directory</h3>
              <p className="admin-ad-lead">
                Nombre, UPN, correo (si aplica) y sAM que quedaron guardados o que devolvió el
                resultado del script; alínelo con <strong>Usuarios y equipos de Active Directory</strong>.
              </p>
              <div className="success-table">
                <div className="success-row">
                  <span className="success-label">NOMBRE COMPLETO</span>
                  <span className="success-value">{adDisplay}</span>
                </div>
                <div className="success-row">
                  <span className="success-label">UPN</span>
                  <span className="success-value highlight">{adUpn}</span>
                </div>
                {adMail ? (
                  <div className="success-row">
                    <span className="success-label">Correo (atributo mail)</span>
                    <span className="success-value highlight">{adMail}</span>
                  </div>
                ) : null}
                <div className="success-row">
                  <span className="success-label">USUARIO (sAMAccountName)</span>
                  <span className="success-value mono">{adSam}</span>
                </div>
                {createdUser.requestId && (
                  <div className="success-row">
                    <span className="success-label">ID DE SOLICITUD</span>
                    <span className="success-value mono">{createdUser.requestId}</span>
                  </div>
                )}
                {createdUser.adOrganizationalUnitDn?.trim() && (
                  <div className="success-row">
                    <span className="success-label">
                      UBICACIÓN EN ACTIVE DIRECTORY (OU)
                    </span>
                    <span className="success-value mono">
                      {createdUser.adOrganizationalUnitDn.trim()}
                    </span>
                  </div>
                )}
              </div>
              {adminEncoladoPropuesta ? (
                <details className="admin-ad-proposal-details">
                  <summary>Valores propuestos al encolar (referencia)</summary>
                  <div className="success-table" style={{ marginTop: 12 }}>
                    <div className="success-row">
                      <span className="success-label">NOMBRE (propuesta)</span>
                      <span className="success-value muted">
                        {adminEncoladoPropuesta.displayName}
                      </span>
                    </div>
                    <div className="success-row">
                      <span className="success-label">UPN / correo (propuesta)</span>
                      <span className="success-value muted">
                        {adminEncoladoPropuesta.email}
                      </span>
                    </div>
                    <div className="success-row">
                      <span className="success-label">Usuario (propuesta)</span>
                      <span className="success-value muted mono">
                        {adminEncoladoPropuesta.userName}
                      </span>
                    </div>
                  </div>
                </details>
              ) : null}
            </>
          ) : null}

          {isAdmin && !adminAdIdentityConfirmed && (
            <>
              <h3 className="admin-ad-section-h3">Propuesta al encolar</h3>
              <p className="admin-ad-lead">
                Valores devueltos al aceptar la cola. El sAM/UPN definitivo lo fija el script en
                Active Directory; al confirmar, se mostrarán abajo y podrán diferir.
              </p>
              <div className="success-table">
                <div className="success-row">
                  <span className="success-label">NOMBRE COMPLETO</span>
                  <span className="success-value">{createdUser.displayName}</span>
                </div>
                <div className="success-row">
                  <span className="success-label">UPN / CORREO (propuesta)</span>
                  <span
                    className={
                      adScriptResult?.status === 'error'
                        ? 'success-value success-value--pending'
                        : 'success-value highlight'
                    }
                  >
                    {adScriptResult?.status === 'error'
                      ? 'No confirmado en AD — detalle en “Estado de procesamiento en el servidor”.'
                      : createdUser.email}
                  </span>
                </div>
                <div className="success-row">
                  <span className="success-label">USUARIO (propuesta)</span>
                  <span
                    className={
                      adScriptResult?.status === 'error'
                        ? 'success-value success-value--pending'
                        : 'success-value'
                    }
                  >
                    {adScriptResult?.status === 'error'
                      ? 'No confirmado en AD — vea abajo.'
                      : createdUser.userName}
                  </span>
                </div>
                {createdUser.requestId && (
                  <div className="success-row">
                    <span className="success-label">ID DE SOLICITUD</span>
                    <span className="success-value mono">{createdUser.requestId}</span>
                  </div>
                )}
                {createdUser.adOrganizationalUnitDn?.trim() && (
                  <div className="success-row">
                    <span className="success-label">
                      UBICACIÓN EN ACTIVE DIRECTORY (OU)
                    </span>
                    <span className="success-value mono">
                      {createdUser.adOrganizationalUnitDn.trim()}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}

          <div className="success-note">
            {createdUser.creationType === 'administrative' ? (
              isAdminProfileUpdate ? (
                <>
                  Se actualizarán en Active Directory los datos enviados (nombre, apellidos, puesto,
                  departamento y sede/ciudad). La cuenta y la contraseña existentes no cambian por
                  esta solicitud.
                </>
              ) : (
                <>
                  La contraseña inicial la define el script de Active Directory en el servidor.{' '}
                  {adminAdIdentityConfirmed
                    ? 'Los valores de “Valores en Active Directory” son el referente comprobado con el directorio; si aún duda, abra el objeto de usuario en AD.'
                    : 'Cuando el script confirme, verá en pantalla el nombre, UPN y usuario definitivos; pueden diferir de la fila de propuesta de arriba.'}
                </>
              )
            ) : (
              <>
                <strong>Contraseña inicial ({INITIAL_PASSWORD_M365}):</strong> el usuario deberá
                cambiarla al iniciar sesión en Microsoft 365.
              </>
            )}
          </div>

          {createdUser.creationType === 'administrative' && createdUser.requestId ? (
            <div className="ad-queue-result-block" style={{ marginTop: 20 }}>
              <h4 className="section-title" style={{ fontSize: '0.95rem', marginBottom: 8 }}>
                Estado de procesamiento en el servidor
              </h4>
              {!adScriptResult && !adScriptPollExhausted ? (
                <>
                  <p className="note" style={{ marginTop: 0 }}>
                    Consultando si el script del servidor ya procesó la solicitud…
                  </p>
                  <p className="note" style={{ marginTop: 8, fontSize: 12, opacity: 0.92 }}>
                    Si pasa de uno o dos minutos sin cambio, en el servidor de Active Directory suele
                    faltar el script en modo continuo (<code>-Continuous</code>); véase{' '}
                    <code>docs/server-scripts/README.md</code>.
                  </p>
                </>
              ) : null}
              {adScriptPollExhausted && !adScriptResult ? (
                <div style={{ marginTop: 0 }}>
                  <p className="note">
                    No hubo respuesta en el tiempo de espera automático (unos{' '}
                    {AD_RESULT_POLL_WINDOW_MINUTES} minutos). Ejecute el script en el servidor con{' '}
                    <code>-Continuous</code> o una tarea más frecuente, o pulse «Comprobar estado».
                  </p>
                  {adPollLastError ? (
                    <p className="error-text" style={{ marginTop: 10, marginBottom: 0 }}>
                      <strong>Detalle del último intento:</strong> {adPollLastError}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {adScriptResult?.status === 'success' ? (
                <p className="note success-note" style={{ marginTop: 0 }}>
                  {adScriptResult.message}
                  {adScriptResult.processedAt ? (
                    <span className="mono"> — {adScriptResult.processedAt}</span>
                  ) : null}
                </p>
              ) : null}
              {adScriptResult?.status === 'error' ? (
                <div style={{ marginTop: 0 }}>
                  {isAdScriptDuplicateEmployeeIdMessage(adScriptResult.message) ? (
                    <>
                      <p className="error-text" style={{ marginTop: 0, marginBottom: 8 }}>
                        <strong>Cédula duplicada en Active Directory.</strong>
                      </p>
                      <p className="error-text" style={{ marginTop: 0 }}>
                        {adScriptResult.message}
                      </p>
                      <p className="note" style={{ marginTop: 10 }}>
                        Este rechazo proviene del directorio local (AD), no de la validación previa en
                        Microsoft 365. Si la cédula acaba de usarse, Graph puede tardar varios minutos
                        en reflejarla tras Azure AD Connect; puede configurar el prechequeo LDAP en el
                        servidor (variables AD_LDAP_* en el .env del backend) para detectar duplicados
                        antes de encolar.
                      </p>
                    </>
                  ) : (
                    <p className="error-text" style={{ marginTop: 0 }}>
                      {adScriptResult.message}
                    </p>
                  )}
                </div>
              ) : null}
              <button
                type="button"
                className="secondary-btn"
                disabled={adManualCheckLoading}
                onClick={handleRefreshAdScriptResult}
                style={{ marginTop: 10 }}
              >
                {adManualCheckLoading ? 'Consultando…' : 'Comprobar estado'}
              </button>
            </div>
          ) : null}

          <button className="primary-btn" onClick={handleCreateAnother}>
            Crear otro usuario
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="dark-form" onSubmit={handleSubmit}>
      <div className="user-type-tabs" role="tablist" aria-label="Tipo de usuario">
        <button
          type="button"
          role="tab"
          aria-selected={userCreationType === 'operational'}
          className={`user-type-tab ${userCreationType === 'operational' ? 'active' : ''}`}
          onClick={() => {
            setUserCreationType('operational');
            setValidationModalOpen(false);
            setStatus('idle');
            setErrorMessage('');
            setBulkAdminResults(null);
            setBulkAdminFile(null);
            setBulkAdminStatus('idle');
            setBulkAdminMessage('');
            setQueueConnStatus('idle');
            setQueueConnDetail(null);
            setAdminSmbGatePassed(false);
          }}
        >
          Operativo (Microsoft 365)
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={userCreationType === 'administrative'}
          className={`user-type-tab ${userCreationType === 'administrative' ? 'active' : ''}`}
          onClick={() => {
            setUserCreationType('administrative');
            setValidationModalOpen(false);
            setStatus('idle');
            setErrorMessage('');
            setBulkResults(null);
            setBulkFile(null);
            setBulkStatus('idle');
            setBulkMessage('');
            setAdminSmbGatePassed(false);
            setQueueConnStatus('idle');
            setQueueConnDetail(null);
          }}
        >
          Administrativo (Active Directory)
        </button>
      </div>

      {userCreationType === 'administrative' && (
        <section className="dark-section">
          <h3 className="section-title">CONEXIÓN A LA CARPETA DE COLA (SMB)</h3>
          <p className="note" style={{ marginTop: 0 }}>
            {adminSmbGatePassed
              ? 'Conexión verificada. Puede volver a pulsar el botón si necesita comprobarla de nuevo.'
              : 'Antes de rellenar datos, crear usuarios o cargar Excel, compruebe que el equipo donde corre el backend puede escribir en la ruta AD_QUEUE_UNC.'}
          </p>
          <button
            type="button"
            className="secondary-btn"
            disabled={queueConnStatus === 'loading'}
            onClick={handleTestQueueConnection}
          >
            {queueConnStatus === 'loading' ? 'Probando conexión…' : 'Probar conexión'}
          </button>
          {queueConnStatus === 'success' && queueConnDetail?.ok && (
            <p className="note success-note">
              {queueConnDetail.message}
              {queueConnDetail.uncPath ? (
                <>
                  {' '}
                  Ruta: <code>{queueConnDetail.uncPath}</code>
                </>
              ) : null}
            </p>
          )}
          {queueConnStatus === 'error' && queueConnDetail && (
            <>
              <p className="error-text" style={{ marginTop: 12 }}>
                {queueConnDetail.message}
                {queueConnDetail.uncPath ? (
                  <>
                    {' '}
                    (<code>{queueConnDetail.uncPath}</code>)
                  </>
                ) : null}
                {queueConnDetail.code ? ` [${queueConnDetail.code}]` : ''}
              </p>
              <p className="note" style={{ marginTop: 16 }}>
                Pasos recomendados:
              </p>
              <ol className="queue-help-steps">
                {SMB_QUEUE_HELP_STEPS.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </>
          )}
        </section>
      )}

      {(userCreationType === 'operational' || adminSmbGatePassed) && (
      <>
      <section className="dark-section">
        <h3 className="section-title">DATOS PERSONALES</h3>
        <p className="admin-only-fields-note">
          Los únicos campos opcionales son <strong>segundo nombre</strong> y{' '}
          <strong>segundo apellido</strong>.
        </p>

        <div className="two-col">
          <div className="field-group">
            <label>PRIMER NOMBRE{CAMPO_OBLIGATORIO}</label>
            <input
              name="primerNombre"
              value={formData.primerNombre}
              onChange={handleChange}
              maxLength={NAME_AND_JOB_MAX}
              autoComplete="given-name"
            />
            {errors.primerNombre && (
              <p className="error-text">{errors.primerNombre}</p>
            )}
          </div>

          <div className="field-group">
            <label>
              SEGUNDO NOMBRE
              <span className="field-optional-tag"> (opcional)</span>
            </label>
            <input
              name="segundoNombre"
              value={formData.segundoNombre}
              onChange={handleChange}
              maxLength={NAME_AND_JOB_MAX}
              autoComplete="additional-name"
            />
            {errors.segundoNombre && (
              <p className="error-text">{errors.segundoNombre}</p>
            )}
          </div>
        </div>

        <div className="two-col">
          <div className="field-group">
            <label>PRIMER APELLIDO{CAMPO_OBLIGATORIO}</label>
            <input
              name="apellido1"
              value={formData.apellido1}
              onChange={handleChange}
              maxLength={NAME_AND_JOB_MAX}
              autoComplete="family-name"
            />
            {errors.apellido1 && (
              <p className="error-text">{errors.apellido1}</p>
            )}
          </div>

          <div className="field-group">
            <label>
              SEGUNDO APELLIDO
              <span className="field-optional-tag"> (opcional)</span>
            </label>
            <input
              name="apellido2"
              value={formData.apellido2}
              onChange={handleChange}
              maxLength={NAME_AND_JOB_MAX}
            />
            {errors.apellido2 && (
              <p className="error-text">{errors.apellido2}</p>
            )}
          </div>
        </div>
      </section>

      <section className="dark-section">
        <h3 className="section-title">Información del puesto</h3>

        <div className="two-col">
          <div className="field-group">
            <label>PUESTO{CAMPO_OBLIGATORIO}</label>
            <input
              name="puesto"
              value={formData.puesto}
              onChange={handleChange}
              maxLength={NAME_AND_JOB_MAX}
              autoComplete="organization-title"
            />
            {errors.puesto && (
              <p className="error-text">{errors.puesto}</p>
            )}
          </div>

          <div className="field-group">
            <label>DEPARTAMENTO{CAMPO_OBLIGATORIO}</label>
            <input
              name="departamento"
              value={formData.departamento}
              onChange={handleChange}
              maxLength={NAME_AND_JOB_MAX}
            />
            {errors.departamento && (
              <p className="error-text">{errors.departamento}</p>
            )}
          </div>
        </div>

        {userCreationType === 'operational' && (
          <div className="two-col" style={{ marginTop: 16 }}>
            <div className="field-group">
              <label htmlFor="op-sede">SEDE{CAMPO_OBLIGATORIO}</label>
              <select
                id="op-sede"
                name="sede"
                value={formData.sede}
                onChange={handleChange}
              >
                <option value="">Seleccione…</option>
                {OPERATIONAL_SEDE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {errors.sede && <p className="error-text">{errors.sede}</p>}
              <p className="note" style={{ marginTop: 8 }}>
                Clasificación para asignación automática al grupo de Microsoft 365 correspondiente a la
                sede.
              </p>
            </div>
            <div className="field-group">
              <label htmlFor="op-postal">CÓDIGO POSTAL{CAMPO_OBLIGATORIO}</label>
              <input
                id="op-postal"
                name="postalCode"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="postal-code"
                value={formData.postalCode}
                onChange={handleChange}
                maxLength={OPERATIONAL_POSTAL_MAX}
                placeholder="Solo dígitos"
              />
              {errors.postalCode && (
                <p className="error-text">{errors.postalCode}</p>
              )}
              <p className="note" style={{ marginTop: 8 }}>
                Entre {OPERATIONAL_POSTAL_MIN} y {OPERATIONAL_POSTAL_MAX} dígitos. En carga masiva Excel
                use la columna «Codigo postal» (o CP, ZIP).
              </p>
            </div>
          </div>
        )}

      </section>

      {userCreationType === 'administrative' && (
        <section className="dark-section admin-location-section">
          <h3 className="section-title">Documento y ubicación</h3>
          <div className="two-col admin-location-grid">
            <div className="field-group">
              <label htmlFor="admin-cedula">
                Cédula / ID empleado{CAMPO_OBLIGATORIO}
              </label>
              <input
                id="admin-cedula"
                name="cedula"
                value={formData.cedula}
                onChange={handleChange}
                maxLength={EMPLOYEE_ID_MAX}
                autoComplete="off"
                placeholder="Ej. 12345678"
              />
              {errors.cedula && <p className="error-text">{errors.cedula}</p>}
            </div>
            <div className="field-group admin-sede-field">
              <label htmlFor="admin-ciudad-select">
                Ciudad / sede{CAMPO_OBLIGATORIO}
              </label>
              <select
                id="admin-ciudad-select"
                name="ciudad"
                className="admin-sede-select"
                value={formData.ciudad}
                onChange={handleChange}
              >
                <option value="">Seleccione una opción…</option>
                {ADMINISTRATIVE_CITY_SELECT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {errors.ciudad && <p className="error-text">{errors.ciudad}</p>}
            </div>
          </div>
          <div className="field-group admin-postal-field">
            <label htmlFor="admin-postal">Código postal{CAMPO_OBLIGATORIO}</label>
            <input
              id="admin-postal"
              name="postalCode"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="postal-code"
              value={formData.postalCode}
              onChange={handleChange}
              maxLength={OPERATIONAL_POSTAL_MAX}
              placeholder="Solo dígitos"
            />
            {errors.postalCode && (
              <p className="error-text">{errors.postalCode}</p>
            )}
            <p className="note" style={{ marginTop: 8 }}>
              Entre {OPERATIONAL_POSTAL_MIN} y {OPERATIONAL_POSTAL_MAX} dígitos. En Excel use la columna «Codigo postal»
              (o CP, ZIP).
            </p>
          </div>
        </section>
      )}

      {userCreationType === 'operational' && (
        <section className="dark-section">
          <h3 className="section-title">CARGA MASIVA DESDE EXCEL</h3>

          <div className="field-group">
            <label>ARCHIVO DE EXCEL</label>
            <div className="bulk-upload-panel">
              <div className="bulk-upload-toolbar">
                <div className="bulk-upload-file-row">
                  <input
                    id="bulk-operational-file"
                    className="bulk-upload-sr-only"
                    type="file"
                    accept=".xlsx,.xls"
                    aria-label="Seleccionar archivo Excel de operarios"
                    onChange={handleBulkFileChange}
                  />
                  <label
                    htmlFor="bulk-operational-file"
                    className="bulk-upload-pick-btn"
                  >
                    Elegir archivo…
                  </label>
                  <span
                    className={`bulk-upload-file-name ${bulkFile ? '' : 'muted'}`}
                    title={bulkFile?.name ?? undefined}
                  >
                    {bulkFile ? bulkFile.name : 'Ningún archivo seleccionado'}
                  </span>
                </div>
                <a
                  className="secondary-btn bulk-upload-template-btn"
                  href={PLANTILLA_OPERARIOS_HREF}
                  {...plantillaDownloadLinkProps(PLANTILLA_OPERARIOS_HREF, 'plantilla operarios.xlsx')}
                >
                  Descargar plantilla
                </a>
                {plantillaOrigenNote(PLANTILLA_OPERARIOS_HREF, 'operational')}
              </div>
              <details className="bulk-upload-help">
                <summary>Instrucciones y formato del Excel</summary>
                <div className="bulk-help-body">
                  <p className="bulk-help-intro">
                    Use <strong>Descargar plantilla</strong> si aún no tiene el archivo. Cada fila que
                    pase la validación crea el usuario en <strong>Microsoft 365</strong> (Entra ID) y se
                    aplican las membresías de grupo según la <strong>sede</strong> y la configuración del
                    servidor.
                  </p>

                  <h4 className="bulk-help-heading">Columnas, obligatoriedad y tipo de dato</h4>
                  <p className="bulk-help-note bulk-help-note--emphasis">
                    Use la <strong>plantilla descargable</strong> para no omitir columnas: el archivo debe
                    traer <strong>todas las columnas previstas</strong>. En alta operativa solo son{' '}
                    <strong>opcionales</strong> segundo nombre y segundo apellido; el resto es{' '}
                    <strong>obligatorio</strong>. En <strong>nombres, apellidos, puesto y departamento</strong>{' '}
                    use solo letras (incluye tildes y ñ), espacios y guiones; máximo 50 caracteres en
                    puesto y departamento. El <strong>código postal</strong> es solo dígitos; puede
                    escribirlo como texto en Excel.
                  </p>
                  <ul className="bulk-help-list bulk-help-list--columns">
                    <li>
                      <strong>Primer nombre</strong> <span className="bulk-help-tag">(obligatorio)</span>{' '}
                      · Texto (solo letras, espacios y guiones). Mínimo 3 caracteres.
                    </li>
                    <li>
                      <strong>Segundo nombre</strong> <span className="bulk-help-tag">(opcional)</span>{' '}
                      · Texto. Déjelo vacío si no aplica.
                    </li>
                    <li>
                      <strong>Primer apellido</strong> <span className="bulk-help-tag">(obligatorio)</span>{' '}
                      · Texto (solo letras, espacios y guiones). Mínimo 3 caracteres.
                    </li>
                    <li>
                      <strong>Segundo apellido</strong> <span className="bulk-help-tag">(opcional)</span>{' '}
                      · Texto. Celda vacía si no aplica. También puede usar una sola columna «Apellidos»
                      con ambos apellidos, o dos columnas «Apellido» (1.º y 2.º), según la plantilla.
                    </li>
                    <li>
                      <strong>Puesto</strong> <span className="bulk-help-tag">(obligatorio)</span> · Solo
                      letras, espacios y guiones. Mínimo 3 y máximo 50 caracteres.
                    </li>
                    <li>
                      <strong>Departamento</strong> <span className="bulk-help-tag">(obligatorio)</span> ·
                      Mismo criterio que puesto. Máximo 50 caracteres.
                    </li>
                    <li>
                      <strong>Sede</strong> <span className="bulk-help-tag">(obligatorio)</span> · Texto.
                      Debe coincidir <strong>exactamente</strong> con uno de estos valores:{' '}
                      {OPERATIONAL_SEDE_OPTIONS.join(', ')}.
                    </li>
                    <li>
                      <strong>Código postal</strong> <span className="bulk-help-tag">(obligatorio)</span>{' '}
                      · Solo dígitos, entre 4 y 10 (sin letras ni símbolos). Encabezados admitidos, por
                      ejemplo: Codigo postal, CP, ZIP.
                    </li>
                  </ul>

                  <h4 className="bulk-help-heading">Qué ocurre al cargar el archivo</h4>
                  <p className="bulk-help-note">
                    El servidor procesa las filas y llama a Microsoft Graph para crear cada cuenta. El
                    correo y el nombre de usuario (<strong>UPN</strong>) se generan con reglas propias de{' '}
                    <strong>operativos</strong> (combinaciones de nombres y apellidos; si hace falta,
                    sufijos <code>.1</code>, <code>.2</code>, etc.). Esa lógica{' '}
                    <strong>no es la misma</strong> que la de usuarios administrativos en la cola de
                    Active Directory. Tras la creación se intenta agregar al usuario a los grupos de M365
                    configurados (sede y grupos comunes).
                  </p>
                </div>
              </details>
            </div>
          </div>

          <div className="bulk-upload-actions-spacer">
            <button
              type="button"
              className="primary-btn"
              disabled={bulkStatus === 'loading'}
              onClick={handleBulkUpload}
            >
              {bulkStatus === 'loading' ? 'Cargando usuarios…' : 'Cargar usuarios desde Excel'}
            </button>
          </div>

          {bulkMessage && (
            <p className={bulkStatus === 'error' ? 'error-text' : 'note'}>
              {bulkMessage}
            </p>
          )}
        </section>
      )}

      {userCreationType === 'administrative' && (
        <section className="dark-section">
          <h3 className="section-title">CARGA MASIVA DESDE EXCEL (COLA AD)</h3>

          <div className="field-group">
            <label>ARCHIVO DE EXCEL</label>
            <div className="bulk-upload-panel">
              <div className="bulk-upload-toolbar">
                <div className="bulk-upload-file-row">
                  <input
                    id="bulk-administrative-file"
                    className="bulk-upload-sr-only"
                    type="file"
                    accept=".xlsx,.xls"
                    aria-label="Seleccionar archivo Excel de administrativos"
                    onChange={handleBulkAdminFileChange}
                  />
                  <label
                    htmlFor="bulk-administrative-file"
                    className="bulk-upload-pick-btn"
                  >
                    Elegir archivo…
                  </label>
                  <span
                    className={`bulk-upload-file-name ${bulkAdminFile ? '' : 'muted'}`}
                    title={bulkAdminFile?.name ?? undefined}
                  >
                    {bulkAdminFile ? bulkAdminFile.name : 'Ningún archivo seleccionado'}
                  </span>
                </div>
                <a
                  className="secondary-btn bulk-upload-template-btn"
                  href={PLANTILLA_ADMINISTRATIVOS_HREF}
                  {...plantillaDownloadLinkProps(
                    PLANTILLA_ADMINISTRATIVOS_HREF,
                    'plantilla administrativos.xlsx'
                  )}
                >
                  Descargar plantilla
                </a>
                {plantillaOrigenNote(PLANTILLA_ADMINISTRATIVOS_HREF, 'administrative')}
              </div>
              <details className="bulk-upload-help">
                <summary>Instrucciones y formato del Excel</summary>
                <div className="bulk-help-body">
                  <p className="bulk-help-intro">
                    Use <strong>Descargar plantilla</strong> si aún no tiene el archivo. Cada fila que
                    pase la validación se encola como un archivo JSON en la carpeta compartida de
                    Active Directory.
                  </p>

                  <h4 className="bulk-help-heading">Columnas, obligatoriedad y tipo de dato</h4>
                  <p className="bulk-help-note bulk-help-note--emphasis">
                    Use la <strong>plantilla descargable</strong> para no omitir columnas. En alta
                    administrativa solo son <strong>opcionales</strong> segundo nombre y segundo apellido; el
                    resto de columnas de la plantilla es <strong>obligatorio</strong>. Salvo donde se indica
                    «solo dígitos», el contenido se interpreta como <strong>texto</strong> (incluido documento
                    y código postal, para evitar cambios automáticos de Excel).
                  </p>
                  <ul className="bulk-help-list bulk-help-list--columns">
                    <li>
                      <strong>Primer nombre</strong> <span className="bulk-help-tag">(obligatorio)</span>{' '}
                      · Texto. Mínimo 3 caracteres.
                    </li>
                    <li>
                      <strong>Segundo nombre</strong> <span className="bulk-help-tag">(opcional)</span>{' '}
                      · Texto. Déjelo vacío si la persona no tiene segundo nombre.
                    </li>
                    <li>
                      <strong>Primer apellido</strong> <span className="bulk-help-tag">(obligatorio)</span>{' '}
                      · Texto. Mínimo 3 caracteres.
                    </li>
                    <li>
                      <strong>Segundo apellido</strong> <span className="bulk-help-tag">(opcional)</span>{' '}
                      · Texto. Celda vacía si no aplica. También puede usar una sola columna «Apellidos»
                      con ambos apellidos, o dos columnas «Apellido» (1.º y 2.º), según la plantilla.
                    </li>
                    <li>
                      <strong>Puesto</strong> <span className="bulk-help-tag">(obligatorio)</span> · Texto.
                    </li>
                    <li>
                      <strong>Departamento</strong> <span className="bulk-help-tag">(obligatorio)</span> ·
                      Texto.
                    </li>
                    <li>
                      <strong>Documento / cédula / ID empleado</strong>{' '}
                      <span className="bulk-help-tag">(obligatorio)</span> · Texto. Entre 5 y 32
                      caracteres (alfanumérico y guiones). En Excel aplique formato de celda{' '}
                      <strong>Texto</strong> para no perder ceros a la izquierda.
                    </li>
                    <li>
                      <strong>Ciudad / sede</strong> <span className="bulk-help-tag">(obligatorio)</span> ·
                      Una de: Segovia, Medellín, Bogotá, PSN, Marmato, Lower Mine. Ese texto es el que quedará en el
                      atributo <strong>Ciudad</strong> en Active Directory; la OU se asigna automáticamente.
                    </li>
                    <li>
                      <strong>Código postal</strong> <span className="bulk-help-tag">(obligatorio)</span>{' '}
                      · Solo dígitos, entre 4 y 10 (sin letras ni símbolos). Puede escribirlo como texto
                      en Excel. Encabezados admitidos: Codigo postal, CP, ZIP, etc.
                    </li>
                  </ul>

                  <h4 className="bulk-help-heading">Qué ocurre al cargar el archivo</h4>
                  <p className="bulk-help-note">
                    Cada fila válida genera un archivo{' '}
                    <code className="bulk-help-code">pendiente-{'{uuid}'}.json</code> en la carpeta de
                    cola configurada en el servidor. El script de Active Directory lee esos archivos y
                    crea el usuario en Active Directory.
                  </p>
                </div>
              </details>
            </div>
          </div>

          <div className="bulk-upload-actions-spacer">
            <button
              type="button"
              className="primary-btn"
              disabled={bulkAdminStatus === 'loading'}
              onClick={handleBulkAdminUpload}
            >
              {bulkAdminStatus === 'loading'
                ? 'Encolando solicitudes…'
                : 'Cargar usuarios administrativos desde Excel'}
            </button>
          </div>

          {bulkAdminMessage && (
            <p className={bulkAdminStatus === 'error' ? 'error-text' : 'note'}>
              {bulkAdminMessage}
            </p>
          )}
        </section>
      )}

      <button
        type="submit"
        className="primary-btn"
        disabled={status === 'loading'}
      >
        {status === 'loading'
          ? 'Creando usuario…'
          : userCreationType === 'operational'
              ? 'Crear usuario operativo'
              : 'Crear usuario administrativo (AD)'}
      </button>

      {status === 'error' && <p className="error-text">{errorMessage}</p>}
      </>
      )}

      {validationModalOpen && (
        <div
          className="validation-modal-backdrop"
          role="presentation"
          onClick={() => setValidationModalOpen(false)}
        >
          <div
            className="validation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="validation-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="validation-modal-title" className="validation-modal-title">
              Faltan datos por completar
            </h2>
            <p className="validation-modal-lead">
              Corrija lo indicado a continuación. Los mismos avisos aparecen junto a cada campo en el
              formulario.
            </p>
            <ul className="validation-modal-list">
              {validationModalLines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
            <button
              type="button"
              className="primary-btn validation-modal-close"
              onClick={() => setValidationModalOpen(false)}
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </form>
  );
};

export default CreateUserForm;