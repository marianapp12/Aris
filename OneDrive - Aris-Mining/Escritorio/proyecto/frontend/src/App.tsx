import React, { useEffect, useMemo, useState } from 'react';
import CreateUserForm from './components/CreateUserForm';
import './App.css';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { Login } from './components/auth/Login';
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
      } catch (e: any) {
        if (!cancelled) {
          setAuthorized(false);
          setAuthzError(
            typeof e?.message === 'string'
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
            <div className="loginLogoPlaceholder">Company Logo</div>
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
            <div className="brand-mark">AM</div>
            <div className="brand-text">
              <span className="brand-name">ARIS MINING</span>
              <span className="brand-sub">Gestión de Usuarios M365</span>
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
            <h1 className="page-title">Crear Usuario Operativo</h1>
            <p className="page-description">
              Complete el formulario para provisionar un nuevo usuario en Microsoft 365.
              El usuario recibirá acceso inicial sin licencia y deberá cambiar su
              contraseña en el primer inicio de sesión.
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
