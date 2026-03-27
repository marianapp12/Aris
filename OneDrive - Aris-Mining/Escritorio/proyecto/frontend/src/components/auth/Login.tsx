import React, { useEffect, useMemo, useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../../auth/msalConfig';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import './login.css';
import { InteractionStatus } from '@azure/msal-browser';

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function Login() {
  const { instance, inProgress } = useMsal();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const [emailError, setEmailError] = useState<string | undefined>();
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();

  const isMsalBusy = inProgress !== InteractionStatus.None;
  const canSubmit = useMemo(() => !loading, [loading]);

  useEffect(() => {
    document.body.classList.add('loginBody');
    return () => document.body.classList.remove('loginBody');
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isMsalBusy || loading) return;
    setFormError(undefined);

    let ok = true;
    if (!email.trim()) {
      setEmailError('Email is required.');
      ok = false;
    } else if (!isValidEmail(email)) {
      setEmailError('Please enter a valid email.');
      ok = false;
    } else {
      setEmailError(undefined);
    }

    if (!password.trim()) {
      setPasswordError('Password is required.');
      ok = false;
    } else {
      setPasswordError(undefined);
    }

    if (!ok) return;

    try {
      setLoading(true);
      await instance.loginRedirect(loginRequest);
      // loginRedirect navega fuera de la SPA; App validará grupo al volver.
    } catch (err: any) {
      const msg =
        typeof err?.message === 'string' ? err.message : 'Authentication failed.';
      setFormError(msg);
      setLoading(false);
    }
  }

  return (
    <div className="loginPage">
      <div className="loginBg" />
      <div className="loginCard fadeIn">
        <div className="loginLogoArea">
          <div className="loginLogoPlaceholder">Company Logo</div>
        </div>

        <div className="loginContent">
          <h1 className="loginTitle">Sign in</h1>
          <p className="loginSubtitle">
            Inicia sesión con tu cuenta corporativa de Microsoft.
          </p>

          <form onSubmit={onSubmit}>
            <Input
              label="Email"
              value={email}
              onChange={setEmail}
              placeholder="name@company.com"
              autoComplete="email"
              error={emailError}
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="••••••••"
              autoComplete="current-password"
              error={passwordError}
            />

            {formError ? <div className="loginFormError">{formError}</div> : null}

            <Button
              type="submit"
              loading={loading || isMsalBusy}
              disabled={!canSubmit || isMsalBusy}
            >
              Continuar con Microsoft
            </Button>

            <div className="loginFooter">
              © {new Date().getFullYear()} Aris Mining Co. All rights reserved.
            </div>
          </form>
        </div>

        {(loading || isMsalBusy) && (
          <div className="authOverlay">
            <div className="authOverlayCard">
              <div className="authSpinner" />
              <p>Cargando autenticación…</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

