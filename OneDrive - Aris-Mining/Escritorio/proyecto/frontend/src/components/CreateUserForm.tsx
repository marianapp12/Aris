import { useState, useMemo, useEffect } from 'react';
import { UserFormData, UserPreview } from '../types/user';
import { createOperationalUser, getNextAvailableUsername } from '../services/apiClient';
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
    setFormData({
      primerNombre: '',
      segundoNombre: '',
      apellido1: '',
      apellido2: '',
      puesto: '',
      departamento: '',
    });
  };

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

      <button className="primary-btn" disabled={status === 'loading'}>
        {status === 'loading' ? 'Creando usuario…' : 'Crear usuario operativo'}
      </button>

      {status === 'error' && <p className="error-text">{errorMessage}</p>}
    </form>
  );
};

export default CreateUserForm;