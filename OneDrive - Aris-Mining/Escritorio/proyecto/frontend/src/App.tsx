import React, { useEffect, useMemo, useState } from 'react';
import CreateUserForm, { INITIAL_PASSWORD_M365 } from './components/CreateUserForm';
import './App.css';
import './components/auth/login.css';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { Login } from './components/auth/Login';
import { BrandLogo } from './components/branding/BrandLogo';
import { ensureUserInLogiGroup } from './auth/graph';
import { InteractionStatus } from '@azure/msal-browser';

const App: React.FC = () => {
  const isAuthenticated = useIsAuthenticated();
  const { instance, accounts, inProgress } = useMsal();
  const account = useMemo(() => accounts[0], [accounts]);

  const [authorized, setAuthorized] = useState<boolean>(false);
  const [authzLoading, setAuthzLoading] = useState<boolean>(false);
  const [authzError, setAuthzError] = useState<string | null>(null);

  const msalReady = inProgress === InteractionStatus.None;

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!msalReady || !isAuthenticated || !account) {
        setAuthorized(false);
        setAuthzError(null);
        setAuthzLoading(false);
        return;
      }

      try {
        setAuthzLoading(true);
        setAuthzError(null);
        await ensureUserInLogiGroup(account);
        if (!cancelled) setAuthorized(true);
      } catch (e: unknown) {
        if (!cancelled) {
          setAuthorized(false);
          setAuthzError(
            e instanceof Error && typeof e.message === 'string'
              ? e.message
              : 'No fue posible validar autorización.'
          );
        }
      } finally {
        if (!cancelled) setAuthzLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [msalReady, isAuthenticated, account]);

  // Render (sin returns antes de hooks, para evitar el error de React)
  if (!msalReady) {
    return (
      <div className="loginPage">
        <div className="loginBg" />
        <div className="loginCard fadeIn">
          <div className="loginLogoArea">
            <BrandLogo className="loginLogoImg" />
          </div>
          <div className="loginContent">
            <h1 className="loginTitle">Loading…</h1>
            <p className="loginSubtitle">Inicializando sesión.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  if (authzLoading) {
    return (
      <div className="app">
        <main className="app-main">
          <div className="page-container">
            <div className="form-card">
              <p>Validando acceso…</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="app">
        <main className="app-main">
          <div className="page-container">
            <div className="form-card">
              <p style={{ marginBottom: 12 }}>
                {authzError || 'Access restricted to authorized personnel.'}
              </p>
              <button
                className="btn-secondary"
                onClick={() => instance.logoutPopup()}
              >
                Cerrar sesión
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <div className="brand">
            <div className="brand-logo-wrap">
              <BrandLogo variant="header" className="brand-logo-img" />
            </div>
            <div className="brand-text">
              <span className="brand-name">ARIS MINING</span>
              <span className="brand-sub">Creación de usuarios</span>
            </div>
          </div>

          <div className="header-badge">
            <span className="badge-dot" />
            Microsoft 365
          </div>

          <button
            className="btn-secondary"
            onClick={() => instance.logoutPopup()}
            style={{ marginLeft: 12 }}
          >
            Salir
          </button>
        </div>
      </header>

      <main className="app-main">
        <div className="page-container">
          <div className="page-header">
            <h1 className="page-title">Creación de usuarios</h1>
            <p className="page-description">
              Use las pestañas del formulario para elegir el tipo de alta:{' '}
              <strong>Operativo (Microsoft 365)</strong> crea la cuenta directamente en el inquilino
              de Microsoft 365; la contraseña inicial asignada es{' '}
              <strong>{INITIAL_PASSWORD_M365}</strong> y el usuario deberá cambiarla en el primer
              inicio de sesión (sin licencia por defecto).{' '}
              <strong>Administrativo (Active Directory)</strong> encola la solicitud para que el
              servidor cree el usuario en AD local (sincronización con M365 vía Azure AD Connect); la
              contraseña inicial la define el script en el servidor.
            </p>
          </div>

          <div className="form-card">
            <CreateUserForm />
          </div>
        </div>
      </main>

      <footer className="app-footer">
        <p>
          © {new Date().getFullYear()} Aris Mining Co. — Sistema interno de
          aprovisionamiento de usuarios.
        </p>
      </footer>
    </div>
  );
};

export default App;
