import { useState, useMemo, useEffect } from 'react';
import { UserFormData, UserPreview } from '../types/user';
import { createOperationalUser, getNextAvailableUsername, uploadBulkUsers } from '../services/apiClient';
import { generateUserName, generateDisplayName } from '../utils/userNameGenerator';
import './CreateUserForm.css';

const DOMAIN = '@mariana28napgmail.onmicrosoft.com';

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
};

const CreateUserForm = () => {

  const [formData, setFormData] = useState<UserFormData>({
    primerNombre: '',
    segundoNombre: '',
    apellido1: '',
    apellido2: '',
    puesto: '',
    departamento: '',
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
    const email = `${userName}${DOMAIN}`;

    return { displayName, userName, email };
  }, [formData.primerNombre, formData.segundoNombre, formData.apellido1, formData.apellido2]);

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
      getNextAvailableUsername({
        givenName: displayGivenName,
        surname1: apellido1Norm,
        surname2: apellido2Norm || undefined,
      })
        .then((data) => setNextUserName(data.userName))
        .catch(() => setNextUserName(null));
    }, 400);

    return () => clearTimeout(timeoutId);
  }, [formData.primerNombre, formData.segundoNombre, formData.apellido1, formData.apellido2]);

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
    ];

    allFields.forEach((field) => {
      const value = formData[field];

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
      };

      const response = await createOperationalUser(payload);

      // Usar SIEMPRE los datos reales devueltos por la API/Azure
      const principal = response.userPrincipalName || response.email;
      const displayName = response.displayName;
      const email = principal;
      const userName = principal.split('@')[0];

      setCreatedUser({
        displayName,
        userName,
        email,
        id: response?.id,
      });

      setStatus('success');
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
    });
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
            El usuario debe cambiar su contraseña en el primer inicio de sesión.
          </p>

          <div className="success-table">
            <div className="success-row">
              <span className="success-label">NOMBRE COMPLETO</span>
              <span className="success-value">
                {createdUser.displayName}
              </span>
            </div>

            <div className="success-row">
              <span className="success-label">CORREO CORPORATIVO</span>
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
          </div>

          <div className="success-note">
            🔑 <strong>Contraseña inicial:</strong> Aris1234* — El usuario deberá cambiarla al iniciar sesión.
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

      <section className="dark-section preview">
        <h3 className="section-title">VISTA PREVIA DE CUENTA M365</h3>

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

      <button className="primary-btn" disabled={status === 'loading'}>
        {status === 'loading' ? 'Creando usuario…' : 'Crear usuario operativo'}
      </button>

      {status === 'error' && <p className="error-text">{errorMessage}</p>}
    </form>
  );
};

export default CreateUserForm;