import { useState, useMemo, useEffect } from 'react';
import { UserFormData, UserPreview } from '../types/user';
import {
  createOperationalUser,
  createAdministrativeUser,
  getNextAvailableUsername,
  getNextAdministrativeUsername,
  getAdministrativeJobStatus,
  uploadBulkUsers,
} from '../services/apiClient';
import { generateUserName, generateDisplayName } from '../utils/userNameGenerator';
import './CreateUserForm.css';

const DOMAIN = '@realizandoprueba123hotmail.onmicrosoft.com';
const AD_UPN_SUFFIX =
  (import.meta.env.VITE_AD_UPN_SUFFIX as string | undefined)?.trim() || 'ad.local';

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
  distinguishedName?: string;
  creationType: UserCreationType;
};

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
  const [status, setStatus] = useState<
    'idle' | 'loading' | 'processing' | 'success' | 'error'
  >('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [nextUserName, setNextUserName] = useState<string | null>(null);
  const [adminJobId, setAdminJobId] = useState<string | null>(null);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkStatus, setBulkStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [bulkMessage, setBulkMessage] = useState<string>('');
  const [bulkResults, setBulkResults] = useState<
    { row: number; status: string; userPrincipalName?: string; displayName?: string; message?: string }[]
    | null
  >(null);

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
  ]);

  // Obtener de la API el nombre de usuario con el que quedará guardada la cuenta
  useEffect(() => {
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
    if (!adminJobId || status !== 'processing') {
      return undefined;
    }
    let cancelled = false;

    const poll = async () => {
      try {
        const st = await getAdministrativeJobStatus(adminJobId);
        if (cancelled) return;
        if (st.status === 'completed' && st.result) {
          const r = st.result;
          setCreatedUser({
            displayName: r.displayName,
            userName: r.sAMAccountName,
            email: r.email || r.userPrincipalName,
            distinguishedName: r.distinguishedName ?? undefined,
            creationType: 'administrative',
          });
          setAdminJobId(null);
          setStatus('success');
        } else if (st.status === 'failed') {
          setErrorMessage(st.error || 'Error al crear el usuario en Active Directory');
          setAdminJobId(null);
          setStatus('error');
        }
      } catch (e) {
        if (cancelled) return;
        setErrorMessage(
          e instanceof Error ? e.message : 'Error al consultar el estado del trabajo'
        );
        setAdminJobId(null);
        setStatus('error');
      }
    };

    void poll();
    const intervalId = window.setInterval(() => void poll(), 10000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [adminJobId, status]);

  const validateField = (name: keyof UserFormData, value: string): string => {
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
    if (name === 'cedula' && value.trim()) {
      if (!/^[0-9A-Za-z-]{1,32}$/.test(value.trim())) {
        return 'Solo alfanuméricos y guiones (máx. 32)';
      }
    }
    if (name === 'ciudad' && value.trim()) {
      if (!/^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ0-9\s.,-]{1,60}$/.test(value.trim())) {
        return 'Caracteres no permitidos en ciudad';
      }
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

      if (field === 'cedula' || field === 'ciudad') {
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

    if (status !== 'idle' && status !== 'processing') {
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
        `Carga completada: ${successCount} usuarios creados, ${errorCount} con error.`
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
              employeeId: formData.cedula.trim() || undefined,
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
        const accepted = await createAdministrativeUser(payload);
        setAdminJobId(accepted.jobId);
        setStatus('processing');
      }
    } catch (err) {
      setStatus('error');
      setErrorMessage(
        err instanceof Error ? err.message : 'Error al crear el usuario'
      );
    }
  };

  const handleCreateAnother = () => {
    setCreatedUser(null);
    setStatus('idle');
    setErrorMessage('');
    setNextUserName(null);
    setBulkResults(null);
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
    setAdminJobId(null);
  };

  // Vista de éxito para carga masiva de usuarios
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
            Se han creado {created.length} usuarios en Microsoft 365.
          </p>

          <div className="success-table">
            {created.map((u, index) => (
              <div className="success-row" key={`success-${index}`}>
                <span className="success-label">
                  USUARIO {index + 1}
                </span>
                <span className="success-value">
                  {u.displayName} — {u.userPrincipalName}
                </span>
              </div>
            ))}
          </div>

          {failed.length > 0 && (
            <>
              <h3 className="success-subtitle">
                Registros con error ({failed.length})
              </h3>
              <div className="success-table">
                {failed.map((u, index) => (
                  <div className="success-row" key={`error-${index}`}>
                    <span className="success-label">
                      FILA {u.row}
                    </span>
                    <span className="success-value">
                      {u.message || 'Error al crear el usuario.'}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="success-note">
            🔑 <strong>Contraseña inicial:</strong> Aris1234* — Los usuarios deberán cambiarla al iniciar sesión.
          </div>

          <button
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

  if (status === 'processing' && adminJobId) {
    return (
      <div className="success-wrapper">
        <div className="success-card">
          <h2 className="success-title">Creación en curso</h2>
          <p className="success-subtitle">
            El usuario se está creando en Active Directory mediante PowerShell. Puede tardar varios
            minutos (replicación y sincronización con Microsoft 365). Esta pantalla se actualizará
            sola.
          </p>
          <p className="note">Identificador de trabajo: {adminJobId}</p>
        </div>
      </div>
    );
  }

  // Vista de éxito para creación individual
  if (status === 'success' && createdUser) {
    return (
      <div className="success-wrapper">
        <div className="success-card">

          <div className="success-icon">✓</div>

          <h2 className="success-title">
            Usuario creado exitosamente
          </h2>

          <p className="success-subtitle">
            {createdUser.creationType === 'administrative'
              ? 'Usuario creado en Active Directory. Debe cambiar su contraseña en el primer inicio de sesión.'
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

            {createdUser.distinguishedName && (
              <div className="success-row">
                <span className="success-label">DN (AD)</span>
                <span className="success-value mono">
                  {createdUser.distinguishedName}
                </span>
              </div>
            )}
          </div>

          <div className="success-note">
            {createdUser.creationType === 'administrative' ? (
              <>
                La contraseña inicial la define el script de su organización (PowerShell). El usuario
                deberá cumplir la política de su dominio al iniciar sesión.
              </>
            ) : (
              <>
                🔑 <strong>Contraseña inicial:</strong> Aris1234* — El usuario deberá cambiarla al
                iniciar sesión.
              </>
            )}
          </div>

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
            setAdminJobId(null);
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
            setAdminJobId(null);
          }}
        >
          Administrativo (Active Directory)
        </button>
      </div>

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
          <h3 className="section-title">DATOS ADICIONALES (OPCIONAL)</h3>
          <div className="two-col">
            <div className="field-group">
              <label>CÉDULA / ID EMPLEADO</label>
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
            : 'VISTA PREVIA DE CUENTA AD (PowerShell)'}
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

      <button
        className="primary-btn"
        disabled={status === 'loading' || status === 'processing'}
      >
        {status === 'loading'
          ? 'Creando usuario…'
          : status === 'processing'
            ? 'Procesando en segundo plano…'
            : userCreationType === 'operational'
              ? 'Crear usuario operativo'
              : 'Crear usuario administrativo (AD)'}
      </button>

      {status === 'error' && <p className="error-text">{errorMessage}</p>}
    </form>
  );
};

export default CreateUserForm;