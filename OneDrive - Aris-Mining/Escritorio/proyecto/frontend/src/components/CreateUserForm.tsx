import { useState, useMemo, useEffect, useRef } from 'react';
import { UserFormData, UserPreview, AdQueueRequestResult } from '../types/user';
import { isAdScriptDuplicateEmployeeIdMessage } from '../utils/adQueueScriptMessages';
import {
  createOperationalUser,
  createUserViaAdQueue,
  getAdministrativeQueueRequestResult,
  getNextAvailableUsername,
  getNextAdministrativeUsername,
  testAdministrativeQueueConnection,
  uploadBulkUsers,
  uploadAdministrativeBulkUsers,
} from '../services/apiClient';
import { generateUserName, generateDisplayName } from '../utils/userNameGenerator';
import './CreateUserForm.css';

const DOMAIN = '@realizandoprueba123hotmail.onmicrosoft.com';
const AD_UPN_SUFFIX =
  (import.meta.env.VITE_AD_UPN_SUFFIX as string | undefined)?.trim() || 'ad.local';

/** Alineado con backend (administrativeUserValidation). */
const EMPLOYEE_ID_MIN = 5;
const EMPLOYEE_ID_MAX = 32;

/** Misma contraseña inicial que graphUserService.js (operativos / Microsoft 365). */
export const INITIAL_PASSWORD_M365 = 'Aris1234*';

type UserCreationType = 'operational' | 'administrative';

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
};

const SMB_QUEUE_HELP_STEPS: string[] = [
  'El navegador no escribe en la carpeta compartida: quien necesita acceso SMB es la máquina (o servidor) donde está ejecutándose el backend Node.',
  'Revise en el servidor que AD_QUEUE_UNC en el archivo .env del backend sea la ruta correcta (por ejemplo \\\\servidor\\carpeta\\pendiente) y, tras cualquier cambio, reinicie el proceso del backend. En esa misma PC con Windows, pulse Win + R, escriba la misma ruta UNC y pulse Enter; si pide credenciales, use un usuario de dominio o del servidor con permiso de escritura en el recurso compartido.',
  'Vuelva a pulsar “Probar conexión” cuando haya completado los pasos anteriores.',
];

const AD_RESULT_POLL_MS = 4000;
const AD_RESULT_MAX_POLLS = 75;

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
    cedula: '',
    ciudad: '',
  });

  const [createdUser, setCreatedUser] = useState<CreatedUser | null>(null);

  const [errors, setErrors] = useState<Partial<Record<keyof UserFormData, string>>>({});
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [nextUserName, setNextUserName] = useState<string | null>(null);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkStatus, setBulkStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [bulkMessage, setBulkMessage] = useState<string>('');
  const [bulkResults, setBulkResults] = useState<
    {
      row: number;
      status: string;
      userPrincipalName?: string;
      displayName?: string;
      message?: string;
      code?: string;
    }[]
    | null
  >(null);

  const [bulkAdminFile, setBulkAdminFile] = useState<File | null>(null);
  const [bulkAdminStatus, setBulkAdminStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [bulkAdminMessage, setBulkAdminMessage] = useState<string>('');
  const [bulkAdminResults, setBulkAdminResults] = useState<
    {
      row: number;
      status: string;
      userPrincipalName?: string;
      displayName?: string;
      requestId?: string;
      proposedUserName?: string;
      queueAction?: 'create' | 'updateByEmployeeId';
      message?: string;
      /** Código de prechequeo / negocio cuando el backend lo envía (p. ej. AdministrativePrecheckError). */
      code?: string;
    }[]
    | null
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

  const [adScriptResult, setAdScriptResult] = useState<AdQueueRequestResult | null>(null);
  const [adScriptPollExhausted, setAdScriptPollExhausted] = useState(false);
  const [adManualCheckLoading, setAdManualCheckLoading] = useState(false);
  const adPollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const userPreview = useMemo<UserPreview | null>(() => {
    const rawPrimerNombre = formData.primerNombre.trim();
    const rawSegundoNombre = formData.segundoNombre.trim();
    const rawApellido1 = formData.apellido1.trim();
    const rawApellido2 = formData.apellido2.trim();

    const primerNombreNorm = toTitleCase(rawPrimerNombre);
    const segundoNombreNorm = rawSegundoNombre ? toTitleCase(rawSegundoNombre) : '';
    const apellido1Norm = toTitleCase(rawApellido1);
    const apellido2Norm = rawApellido2 ? toTitleCase(rawApellido2) : '';

    const displayGivenName = [primerNombreNorm, segundoNombreNorm]
      .filter(Boolean)
      .join(' ');

    const fullSurname = [apellido1Norm, apellido2Norm].filter(Boolean).join(' ');

    const givenNameForUserName = primerNombreNorm;

    if (!givenNameForUserName || !apellido1Norm) return null;

    const displayName = generateDisplayName(displayGivenName, fullSurname);
    const userName = generateUserName(givenNameForUserName, apellido1Norm);
    const email =
      userCreationType === 'operational'
        ? `${userName}${DOMAIN}`
        : `${userName}@${AD_UPN_SUFFIX}`;

    return { displayName, userName, email };
  }, [
    formData.primerNombre,
    formData.segundoNombre,
    formData.apellido1,
    formData.apellido2,
    userCreationType,
    adminSmbGatePassed,
  ]);

  // Obtener de la API el nombre de usuario con el que quedará guardada la cuenta
  useEffect(() => {
    if (userCreationType === 'administrative' && !adminSmbGatePassed) {
      setNextUserName(null);
      return;
    }

    const rawPrimerNombre = formData.primerNombre.trim();
    const rawSegundoNombre = formData.segundoNombre.trim();
    const rawApellido1 = formData.apellido1.trim();
    const rawApellido2 = formData.apellido2.trim();

    const primerNombreNorm = toTitleCase(rawPrimerNombre);
    const segundoNombreNorm = rawSegundoNombre ? toTitleCase(rawSegundoNombre) : '';
    const apellido1Norm = toTitleCase(rawApellido1);
    const apellido2Norm = rawApellido2 ? toTitleCase(rawApellido2) : '';

    const displayGivenName = [primerNombreNorm, segundoNombreNorm].filter(Boolean).join(' ');

    if (primerNombreNorm.length < 3 || apellido1Norm.length < 3) {
      setNextUserName(null);
      return;
    }

    const timeoutId = setTimeout(() => {
      const req = {
        givenName: displayGivenName,
        surname1: apellido1Norm,
        surname2: apellido2Norm || undefined,
      };
      const promise =
        userCreationType === 'operational'
          ? getNextAvailableUsername(req)
          : getNextAdministrativeUsername(req);
      promise.then((data) => setNextUserName(data.userName)).catch(() => setNextUserName(null));
    }, 400);

    return () => clearTimeout(timeoutId);
  }, [
    formData.primerNombre,
    formData.segundoNombre,
    formData.apellido1,
    formData.apellido2,
    userCreationType,
  ]);

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

    async function tick() {
      if (cancelled) return;
      try {
        const r = await getAdministrativeQueueRequestResult(requestId);
        if (cancelled) return;
        if (r.status === 'success' || r.status === 'error') {
          setAdScriptResult(r);
          setAdScriptPollExhausted(false);
          return;
        }
      } catch {
        // Error de red o 503: reintentar hasta el máximo
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
   * Cuando el polling recibe success con userPrincipalName/email del archivo resultado-*.json,
   * alineamos la tarjeta de éxito con lo que quedó en Active Directory.
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

    if (!emailDisplay && !userNameFinal) return;

    setCreatedUser((prev) => {
      if (!prev || prev.creationType !== 'administrative') return prev;
      const nextEmail = emailDisplay || prev.email;
      const nextUser = userNameFinal || prev.userName;
      if (nextEmail === prev.email && nextUser === prev.userName) return prev;
      return { ...prev, email: nextEmail, userName: nextUser };
    });
  }, [adScriptResult, createdUser?.creationType]);

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

    if (name === 'ciudad' && value.trim()) {
      if (!/^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ0-9\s.,-]{1,60}$/.test(value.trim())) {
        return 'Caracteres no permitidos en ciudad';
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

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof UserFormData, string>> = {};

    const required: (keyof UserFormData)[] = [
      'primerNombre',
      'apellido1',
      'puesto',
      'departamento',
    ];

    const allFields: (keyof UserFormData)[] = [
      'primerNombre',
      'segundoNombre',
      'apellido1',
      'apellido2',
      'puesto',
      'departamento',
      'cedula',
      'ciudad',
    ];

    allFields.forEach((field) => {
      const value = formData[field];

      if (field === 'cedula') {
        const error = validateField(field, value);
        if (error) newErrors[field] = error;
        return;
      }

      if (field === 'ciudad') {
        if (!value.trim()) return;
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
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;

    setFormData((prev) => ({ ...prev, [name]: value }));

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

      const resultsArray = Array.isArray(result.results) ? result.results : [];
      const successCount = resultsArray.filter((r: any) => r.status === 'success').length;
      const errorCount = resultsArray.filter((r: any) => r.status === 'error').length;

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
      const resultsArray = Array.isArray(result.results) ? result.results : [];
      const successCount = resultsArray.filter((r: any) => r.status === 'success').length;
      const errorCount = resultsArray.filter((r: any) => r.status === 'error').length;

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

  const handleTestQueueConnection = async () => {
    setQueueConnStatus('loading');
    setQueueConnDetail(null);
    try {
      const data = await testAdministrativeQueueConnection();
      setQueueConnDetail(data);
      setQueueConnStatus(data.ok ? 'success' : 'error');
      setAdminSmbGatePassed(!!data.ok);
    } catch {
      setQueueConnDetail({
        ok: false,
        message: 'No se pudo contactar al servidor o la respuesta no es válida.',
      });
      setQueueConnStatus('error');
      setAdminSmbGatePassed(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

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
        ...(userCreationType === 'administrative'
          ? {
              employeeId: formData.cedula.trim(),
              city: formData.ciudad.trim() || undefined,
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
        });
        setStatus('success');
      } else {
        const accepted = await createUserViaAdQueue(payload);
        const upn = accepted.userPrincipalName ?? '';
        const localPart = upn.includes('@') ? upn.split('@')[0] : '';
        const resolvedUserName = accepted.proposedUserName ?? (localPart || '—');
        setCreatedUser({
          displayName: accepted.displayName,
          userName: resolvedUserName,
          email: upn || '—',
          requestId: accepted.requestId,
          creationType: 'administrative',
          adminQueueAction: accepted.queueAction ?? 'create',
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

  const handleCreateAnother = () => {
    if (adPollTimeoutRef.current) {
      clearTimeout(adPollTimeoutRef.current);
      adPollTimeoutRef.current = null;
    }
    setAdScriptResult(null);
    setAdScriptPollExhausted(false);
    setAdManualCheckLoading(false);
    setCreatedUser(null);
    setStatus('idle');
    setErrorMessage('');
    setNextUserName(null);
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
            Archivos JSON en la carpeta compartida; el procesamiento en el servidor puede tardar
            varios minutos.
          </p>

          <h3 className="bulk-admin-section-heading">Solicitudes encoladas correctamente</h3>
          {created.map((u, index) => (
            <div className="bulk-admin-result-group" key={`admin-bulk-${index}`}>
              <div className="bulk-admin-result-group-title">
                Fila {u.row} —{' '}
                {u.queueAction === 'updateByEmployeeId'
                  ? 'Actualización de perfil'
                  : 'Alta nueva en Active Directory'}
              </div>
              <div className="success-table">
                <div className="success-row">
                  <span className="success-label">NOMBRE (DISPLAY)</span>
                  <span className="success-value">{u.displayName ?? '—'}</span>
                </div>
                {u.queueAction !== 'updateByEmployeeId' ? (
                  <>
                    <div className="success-row">
                      <span className="success-label">UPN PROPUESTO (COLA)</span>
                      <span className="success-value highlight">
                        {u.userPrincipalName ?? '—'}
                      </span>
                    </div>
                    <div className="success-row">
                      <span className="success-label">USUARIO (sAM) PROPUESTO</span>
                      <span className="success-value">{u.proposedUserName ?? '—'}</span>
                    </div>
                  </>
                ) : (
                  u.userPrincipalName && (
                    <div className="success-row">
                      <span className="success-label">UPN CONOCIDO</span>
                      <span className="success-value highlight">{u.userPrincipalName}</span>
                    </div>
                  )
                )}
                <div className="success-row">
                  <span className="success-label">ID DE SOLICITUD</span>
                  <span className="success-value mono">{u.requestId ?? '—'}</span>
                </div>
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
            La contraseña y la creación final en AD las aplica el script en el servidor. Revise la
            carpeta <code>error</code> en el share si alguna fila falló tras el envío.
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
              ? isAdminProfileUpdate
                ? 'La solicitud de actualización de datos se aplicará en Active Directory cuando el servidor procese el archivo; Azure AD Connect sincronizará los cambios con Microsoft 365 y puede tardar varios minutos.'
                : 'La solicitud se guardó en la cola del servidor. El usuario se creará en Active Directory en breve y llegará a Microsoft 365 mediante Azure AD Connect; puede tardar varios minutos.'
              : 'El usuario debe cambiar su contraseña en el primer inicio de sesión.'}
          </p>

          <div className="success-table">
            <div className="success-row">
              <span className="success-label">NOMBRE COMPLETO</span>
              <span className="success-value">
                {createdUser.displayName}
              </span>
            </div>

            <div className="success-row">
              <span className="success-label">
                {createdUser.creationType === 'administrative'
                  ? 'UPN / CORREO'
                  : 'CORREO CORPORATIVO'}
              </span>
              <span className="success-value highlight">
                {createdUser.email}
              </span>
            </div>

            <div className="success-row">
              <span className="success-label">USUARIO</span>
              <span className="success-value">
                {createdUser.userName}
              </span>
            </div>

            {createdUser.requestId && (
              <div className="success-row">
                <span className="success-label">ID DE SOLICITUD</span>
                <span className="success-value mono">{createdUser.requestId}</span>
              </div>
            )}
          </div>

          <div className="success-note">
            {createdUser.creationType === 'administrative' ? (
              isAdminProfileUpdate ? (
                <>
                  Se actualizarán en Active Directory los datos enviados (nombre, apellidos, puesto,
                  departamento y ciudad si aplica). La cuenta y la contraseña existentes no cambian por
                  esta solicitud.
                </>
              ) : (
                <>
                  La contraseña inicial la define el script de Active Directory en el servidor. La
                  fila UPN/correo y usuario se actualizan solas cuando el script confirma el éxito,
                  para mostrar el sAM y UPN finales (pueden diferir de la propuesta del alta).
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
                Resultado en Active Directory
              </h4>
              {!adScriptResult && !adScriptPollExhausted ? (
                <p className="note" style={{ marginTop: 0 }}>
                  Consultando si el script del servidor ya procesó la solicitud…
                </p>
              ) : null}
              {adScriptPollExhausted && !adScriptResult ? (
                <p className="note" style={{ marginTop: 0 }}>
                  No hubo respuesta en el tiempo de espera automático (unos 5 minutos). Ejecute el
                  script en el servidor si aún no lo hizo o pulse «Comprobar estado».
                </p>
              ) : null}
              {adScriptResult?.status === 'success' ? (
                <p className="note success-note" style={{ marginTop: 0 }}>
                  {adScriptResult.message}
                  {adScriptResult.samAccountName ? (
                    <>
                      {' '}
                      <strong>Cuenta AD (sAM):</strong> {adScriptResult.samAccountName}
                    </>
                  ) : null}
                  {adScriptResult.userPrincipalName ? (
                    <>
                      {' '}
                      <strong>UPN:</strong> {adScriptResult.userPrincipalName}
                    </>
                  ) : null}
                  {adScriptResult.email &&
                  adScriptResult.email !== adScriptResult.userPrincipalName ? (
                    <>
                      {' '}
                      <strong>Correo:</strong> {adScriptResult.email}
                    </>
                  ) : null}
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
            setNextUserName(null);
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
            setNextUserName(null);
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

        <div className="two-col">
          <div className="field-group">
            <label>PRIMER NOMBRE *</label>
            <input
              name="primerNombre"
              value={formData.primerNombre}
              onChange={handleChange}
            />
            {errors.primerNombre && (
              <p className="error-text">{errors.primerNombre}</p>
            )}
          </div>

          <div className="field-group">
            <label>SEGUNDO NOMBRE</label>
            <input
              name="segundoNombre"
              value={formData.segundoNombre}
              onChange={handleChange}
            />
            {errors.segundoNombre && (
              <p className="error-text">{errors.segundoNombre}</p>
            )}
          </div>
        </div>

        <div className="two-col">
          <div className="field-group">
            <label>PRIMER APELLIDO *</label>
            <input name="apellido1" value={formData.apellido1} onChange={handleChange} />
            {errors.apellido1 && (
              <p className="error-text">{errors.apellido1}</p>
            )}
          </div>

          <div className="field-group">
            <label>SEGUNDO APELLIDO</label>
            <input name="apellido2" value={formData.apellido2} onChange={handleChange} />
            {errors.apellido2 && (
              <p className="error-text">{errors.apellido2}</p>
            )}
          </div>
        </div>
      </section>

      <section className="dark-section">
        <h3 className="section-title">PUESTO Y DEPARTAMENTO</h3>

        <div className="two-col">
          <div className="field-group">
            <label>PUESTO *</label>
            <input name="puesto" value={formData.puesto} onChange={handleChange} />
            {errors.puesto && (
              <p className="error-text">{errors.puesto}</p>
            )}
          </div>

          <div className="field-group">
            <label>DEPARTAMENTO *</label>
            <input name="departamento" value={formData.departamento} onChange={handleChange} />
            {errors.departamento && (
              <p className="error-text">{errors.departamento}</p>
            )}
          </div>
        </div>
      </section>

      {userCreationType === 'administrative' && (
        <section className="dark-section">
          <h3 className="section-title">CÉDULA / ID Y CIUDAD</h3>
          <div className="two-col">
            <div className="field-group">
              <label>CÉDULA / ID EMPLEADO *</label>
              <input name="cedula" value={formData.cedula} onChange={handleChange} />
              {errors.cedula && <p className="error-text">{errors.cedula}</p>}
            </div>
            <div className="field-group">
              <label>CIUDAD</label>
              <input name="ciudad" value={formData.ciudad} onChange={handleChange} />
              {errors.ciudad && <p className="error-text">{errors.ciudad}</p>}
            </div>
          </div>
        </section>
      )}

      <section className="dark-section preview">
        <h3 className="section-title">
          {userCreationType === 'operational'
            ? 'VISTA PREVIA DE CUENTA M365'
            : 'VISTA PREVIA DE CUENTA AD (cola SMB)'}
        </h3>

        <div className="two-col">
          <div className="field-group">
            <label>NOMBRE PARA MOSTRAR</label>
            <div className="preview-box">{userPreview?.displayName || '—'}</div>
          </div>

          <div className="field-group">
            <label>USUARIO (con el que quedará guardado)</label>
            <div className="preview-box">{nextUserName ?? userPreview?.userName ?? '—'}</div>
          </div>
        </div>
      </section>

      {userCreationType === 'operational' && (
        <section className="dark-section">
          <h3 className="section-title">CARGA MASIVA DESDE EXCEL</h3>

          <div className="field-group">
            <label>ARCHIVO DE EXCEL</label>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleBulkFileChange}
            />
            <p className="note">
              La plantilla debe tener la fila 1 con el título ARIS MINING y la fila 2 con estos
              encabezados: PrimerNombre, SegundoNombre, PrimerApellido, SegundoApellido, Puesto,
              Departamento.
            </p>
          </div>

          <button
            type="button"
            className="primary-btn"
            disabled={bulkStatus === 'loading'}
            onClick={handleBulkUpload}
          >
            {bulkStatus === 'loading' ? 'Cargando usuarios…' : 'Cargar usuarios desde Excel'}
          </button>

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
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleBulkAdminFileChange}
            />
            <p className="note">
              Puede usar fila 1 solo con encabezados y datos desde fila 2, o fila 1 título + fila 2
              encabezados + datos desde fila 3 (el sistema detecta el formato). Columnas:{' '}
              PrimerNombre, SegundoNombre, PrimerApellido, SegundoApellido, Puesto, Departamento,{' '}
              <strong>Cedula</strong> (obligatoria; también acepta Documento o espacios en los
              nombres de columna) y <strong>Ciudad</strong> (opcional). La cédula debe tener al menos
              5 caracteres (mejor formato texto en Excel). Cada fila válida genera un archivo{' '}
              <code>{'pendiente-{uuid}.json'}</code> en la carpeta compartida.
            </p>
          </div>

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

          {bulkAdminMessage && (
            <p className={bulkAdminStatus === 'error' ? 'error-text' : 'note'}>
              {bulkAdminMessage}
            </p>
          )}
        </section>
      )}

      <button
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
    </form>
  );
};

export default CreateUserForm;