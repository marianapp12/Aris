import { useEffect, useMemo, useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../../auth/msalConfig';
import { Button } from '../ui/Button';
import { BrandLogo } from '../branding/BrandLogo';
import './login.css';
import { InteractionStatus } from '@azure/msal-browser';

export function Login() {
  const { instance, inProgress } = useMsal();

  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();

  const isMsalBusy = inProgress !== InteractionStatus.None;
  const canClick = useMemo(() => !loading && !isMsalBusy, [loading, isMsalBusy]);

  useEffect(() => {
    document.body.classList.add('loginBody');
    return () => document.body.classList.remove('loginBody');
  }, []);

  async function handleMicrosoftLogin() {
    if (isMsalBusy || loading) return;
    setFormError(undefined);

    try {
      setLoading(true);
      await instance.loginRedirect(loginRequest);
    } catch (err: unknown) {
      const msg =
        typeof err === 'object' &&
        err !== null &&
        'message' in err &&
        typeof (err as { message: unknown }).message === 'string'
          ? (err as { message: string }).message
          : 'No se pudo iniciar el inicio de sesión. Inténtelo de nuevo.';
      setFormError(msg);
      setLoading(false);
    }
  }

  return (
    <div className="loginPage">
      <div className="loginBg" />
      <div className="loginCard fadeIn">
        <div className="loginLogoArea">
          <BrandLogo className="loginLogoImg" />
        </div>

        <div className="loginContent">
          <h1 className="loginTitle">Iniciar sesión</h1>
          <p className="loginSubtitle">
            Pulse el botón para continuar en la página de inicio de sesión de Microsoft con su cuenta
            corporativa.
          </p>

          <div className="loginActions">
            {formError ? <div className="loginFormError">{formError}</div> : null}

            <Button
              type="button"
              onClick={handleMicrosoftLogin}
              loading={loading || isMsalBusy}
              disabled={!canClick}
            >
              Iniciar sesión con Microsoft
            </Button>

            <div className="loginFooter">
              © {new Date().getFullYear()} Aris Mining Co. All rights reserved.
            </div>
          </div>
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
