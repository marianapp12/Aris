import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function requireEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    throw new Error(`Falta la variable de entorno ${name} para creación AD vía PowerShell`);
  }
  return String(v).trim();
}

/**
 * Configuración para scripts AD (Invoke-Command, EXO/MSOL opcional).
 * Solo se usa en Windows; las variables AD_PS_* deben definirse en .env
 */
export function getAdPowerShellConfig() {
  const root = join(__dirname, '..', '..');
  const defaultCreate = join(root, 'scripts', 'Create-AdAdministrativeUser.ps1');
  const defaultSelect = join(root, 'scripts', 'Select-FirstAvailableAdSam.ps1');

  const skipCloud = process.env.AD_PS_SKIP_CLOUD_STEPS === 'true';

  const cfg = {
    powershellExecutable: process.env.AD_PS_POWERSHELL_PATH?.trim() || 'powershell.exe',
    createScriptPath: process.env.AD_PS_CREATE_SCRIPT_PATH?.trim() || defaultCreate,
    selectSamScriptPath: process.env.AD_PS_SELECT_SAM_SCRIPT_PATH?.trim() || defaultSelect,
    computerName: requireEnv('AD_PS_COMPUTER_NAME'),
    ouPath: requireEnv('AD_PS_OU_PATH'),
    emailDomain: requireEnv('AD_PS_EMAIL_DOMAIN').replace(/^@/, ''),
    company: requireEnv('AD_PS_COMPANY'),
    homeDirectoryRoot: requireEnv('AD_PS_HOME_DIRECTORY_ROOT'),
    groups: (process.env.AD_PS_GROUPS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    passwordGeneratorScriptPath: process.env.AD_PS_PASSWORD_SCRIPT_PATH?.trim() || '',
    skipCloudSteps: skipCloud,
    repadminEnabled: process.env.AD_PS_REPADMIN_ENABLED === 'true',
    repadminLines: process.env.AD_PS_REPADMIN_LINES
      ? process.env.AD_PS_REPADMIN_LINES.split('|||').map((s) => s.trim()).filter(Boolean)
      : [],
    cloudSleepSeconds: Math.max(
      0,
      Number.parseInt(process.env.AD_PS_CLOUD_SLEEP_SECONDS || '240', 10) || 240,
    ),
    mfaBlockEnabled: process.env.AD_PS_MFA_BLOCK_ENABLED === 'true',
    defaultEmployeeId: process.env.AD_PS_DEFAULT_EMPLOYEE_ID?.trim() || '',
    defaultCity: process.env.AD_PS_DEFAULT_CITY?.trim() || '',
    exoUser: process.env.AD_PS_EXO_USER?.trim() || '',
    exoPassword: process.env.AD_PS_EXO_PASSWORD?.trim() || '',
  };

  if (!skipCloud && (!cfg.exoUser || !cfg.exoPassword)) {
    throw new Error(
      'Con AD_PS_SKIP_CLOUD_STEPS distinto de true, defina AD_PS_EXO_USER y AD_PS_EXO_PASSWORD (o active solo pasos locales con AD_PS_SKIP_CLOUD_STEPS=true)',
    );
  }

  return cfg;
}

/**
 * Dominio de correo/UPN sin exigir el resto de AD_PS_* (p. ej. vista previa en Linux).
 */
export function getAdministrativeEmailDomain() {
  const v = process.env.AD_PS_EMAIL_DOMAIN?.trim();
  if (!v) return null;
  return v.replace(/^@/, '');
}

/**
 * Solo lo necesario para Select-FirstAvailableAdSam (no exige EXO / MSOL).
 */
export function getAdPowerShellSelectConfig() {
  const root = join(__dirname, '..', '..');
  const defaultSelect = join(root, 'scripts', 'Select-FirstAvailableAdSam.ps1');
  return {
    powershellExecutable: process.env.AD_PS_POWERSHELL_PATH?.trim() || 'powershell.exe',
    selectSamScriptPath: process.env.AD_PS_SELECT_SAM_SCRIPT_PATH?.trim() || defaultSelect,
    computerName: requireEnv('AD_PS_COMPUTER_NAME'),
    emailDomain: requireEnv('AD_PS_EMAIL_DOMAIN').replace(/^@/, ''),
  };
}

/**
 * Credenciales opcionales para Invoke-Command (WinRM).
 * Útil si AD_PS_COMPUTER_NAME es una IP: agregue el host a TrustedHosts y defina usuario/contraseña de dominio.
 * @returns {Record<string, string>}
 */
export function getWinRmCredentialEnv() {
  const u = process.env.AD_PS_WINRM_USER?.trim();
  const p = process.env.AD_PS_WINRM_PASSWORD?.trim();
  if (!u || !p) return {};
  return { AD_PS_WINRM_USER: u, AD_PS_WINRM_PASSWORD: p };
}
