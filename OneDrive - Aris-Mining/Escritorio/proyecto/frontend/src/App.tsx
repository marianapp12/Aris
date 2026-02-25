import React from 'react';
import CreateUserForm from './components/CreateUserForm';
import './App.css';

const App: React.FC = () => {
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
