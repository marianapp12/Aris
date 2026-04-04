import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { platform } from 'os';
import { randomUUID } from 'crypto';
import {
  getAdPowerShellConfig,
  getAdPowerShellSelectConfig,
  getAdministrativeEmailDomain,
  getWinRmCredentialEnv,
} from '../config/adPowerShellConfig.js';
import { administrativeJobStore } from './administrativeJobStore.js';
import {
  iterateLocalPartCandidates,
  truncateForSamAccountName,
} from '../utils/adUsernameHelpers.js';

const RESULT_PREFIX = 'AD_JOB_RESULT_JSON:';

/** Evita spam en consola cuando el front hace muchas peticiones next-username. */
let lastSelectWinRmWarnAt = 0;
const SELECT_WARN_THROTTLE_MS = 90_000;

/**
 * @param {unknown} msg
 */
function shortenErrorForLog(msg) {
  const s = String(msg || '');
  const first = s.split(/\r?\n/).find((l) => l.trim().length > 0) || s;
  return first.length > 300 ? `${first.slice(0, 297)}...` : first;
}

/**
 * @param {string} stdout
 */
function parseJobResult(stdout) {
  const lines = stdout.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith(RESULT_PREFIX)) {
      return JSON.parse(line.slice(RESULT_PREFIX.length));
    }
  }
  throw new Error('No se encontró AD_JOB_RESULT_JSON en la salida de PowerShell');
}

/**
 * @param {string} exe
 * @param {string} scriptPath
 * @param {string} payloadPath
 * @param {Record<string, string>} envExtra
 */
function runPowerShellScript(exe, scriptPath, payloadPath, envExtra) {
  return new Promise((resolve, reject) => {
    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-PayloadPath',
      payloadPath,
    ];
    const child = spawn(exe, args, {
      env: { ...process.env, ...envExtra },
      windowsHide: true,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.stderr.on('data', (d) => {
      err += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout: out, stderr: err });
    });
  });
}

/**
 * @param {string} exe
 * @param {string} scriptPath
 * @param {object} payloadObject
 * @param {Record<string, string>} envExtra
 */
async function runPowerShellJsonScript(exe, scriptPath, payloadObject, envExtra) {
  const payloadPath = join(tmpdir(), `ad-ps-${randomUUID()}.json`);
  await writeFile(payloadPath, JSON.stringify(payloadObject), 'utf8');
  try {
    const { code, stdout, stderr } = await runPowerShellScript(
      exe,
      scriptPath,
      payloadPath,
      envExtra,
    );
    let result;
    try {
      result = parseJobResult(stdout);
    } catch {
      const tail = (stderr || stdout || '').slice(-4000);
      throw new Error(tail || 'Salida PowerShell no parseable');
    }
    if (!result.ok || code !== 0) {
      throw new Error(result.error || stderr || 'Script PowerShell falló');
    }
    return result;
  } finally {
    await unlink(payloadPath).catch(() => {});
  }
}

function buildCandidateSams(givenName, surname1, surname2) {
  const candidates = [];
  for (const raw of iterateLocalPartCandidates(givenName, surname1, surname2 || '')) {
    candidates.push(truncateForSamAccountName(raw));
  }
  return candidates;
}

/**
 * Primer SamAccountName libre en AD (PowerShell remoto) o primer candidato si falla / no es Windows.
 */
export async function getNextAvailableAdministrativeUsernamePs({ givenName, surname1, surname2 }) {
  const candidates = buildCandidateSams(givenName, surname1, surname2);
  const domain = getAdministrativeEmailDomain();
  if (!domain) {
    throw new Error('Falta AD_PS_EMAIL_DOMAIN en el entorno');
  }

  if (platform() !== 'win32') {
    const sam = candidates[0];
    console.warn(
      '[AD-PS] next-username: no es Windows; se devuelve el primer candidato sin consultar Active Directory',
    );
    return { sAMAccountName: sam, userPrincipalName: `${sam}@${domain}` };
  }

  try {
    const sel = getAdPowerShellSelectConfig();
    const result = await runPowerShellJsonScript(
      sel.powershellExecutable,
      sel.selectSamScriptPath,
      {
        computerName: sel.computerName,
        upnSuffix: domain,
        candidates,
      },
      getWinRmCredentialEnv(),
    );
    return {
      sAMAccountName: result.sAMAccountName,
      userPrincipalName: result.userPrincipalName,
    };
  } catch (e) {
    const now = Date.now();
    if (now - lastSelectWinRmWarnAt >= SELECT_WARN_THROTTLE_MS) {
      lastSelectWinRmWarnAt = now;
      const hint =
        ' Si usa IP en AD_PS_COMPUTER_NAME, defina AD_PS_WINRM_USER y AD_PS_WINRM_PASSWORD y añada el host a WinRM TrustedHosts. Con FQDN, el PC debe alcanzar el dominio (VPN / unido a dominio) para Kerberos.';
      console.warn(
        '[AD-PS] WinRM no pudo consultar AD; se usa el primer candidato de nombre.',
        shortenErrorForLog(e.message),
        hint,
      );
    }
    const sam = candidates[0];
    return { sAMAccountName: sam, userPrincipalName: `${sam}@${domain}` };
  }
}

/**
 * @param {{
 *   givenName: string,
 *   surname1: string,
 *   surname2?: string,
 *   jobTitle: string,
 *   department: string,
 *   employeeId?: string,
 *   city?: string,
 * }} body
 */
export function enqueueAdministrativeUserCreation(body) {
  const jobId = administrativeJobStore.createJob();
  runAdministrativeCreationJob(jobId, body).catch((e) => {
    administrativeJobStore.failJob(jobId, e.message || String(e));
  });
  return jobId;
}

/**
 * @param {string} jobId
 * @param {object} body
 */
async function runAdministrativeCreationJob(jobId, body) {
  administrativeJobStore.setRunning(jobId);
  const logParts = [];

  try {
    if (platform() !== 'win32') {
      throw new Error(
        'La creación administrativa vía PowerShell solo está soportada en Windows. Ejecute el backend en Windows.',
      );
    }

    const cfg = getAdPowerShellConfig();
    const {
      givenName,
      surname1,
      surname2,
      jobTitle,
      department,
      employeeId,
      city,
    } = body;

    const sur = [surname1, surname2].filter(Boolean).join(' ').trim();
    const displayName = `${givenName.trim()} ${sur}`.trim();

    const { sAMAccountName: sam, userPrincipalName: upn } =
      await getNextAvailableAdministrativeUsernamePs({
        givenName,
        surname1,
        surname2,
      });

    const email = upn;
    const empId =
      (employeeId && String(employeeId).trim()) || cfg.defaultEmployeeId || '';
    const cityVal = (city && String(city).trim()) || cfg.defaultCity || '';

    const createPayload = {
      samAccountName: sam,
      userPrincipalName: upn,
      email,
      givenName: givenName.trim(),
      surName: sur,
      displayName,
      title: jobTitle.trim(),
      department: department.trim(),
      company: cfg.company,
      city: cityVal,
      employeeId: empId,
      ouPath: cfg.ouPath,
      computerName: cfg.computerName,
      homeDirectoryRoot: cfg.homeDirectoryRoot,
      groups: cfg.groups,
      skipCloudSteps: cfg.skipCloudSteps,
      repadminEnabled: cfg.repadminEnabled,
      repadminLines: cfg.repadminLines,
      cloudSleepSeconds: cfg.cloudSleepSeconds,
      mfaBlockEnabled: cfg.mfaBlockEnabled,
      passwordGeneratorScriptPath: cfg.passwordGeneratorScriptPath || '',
    };

    const payloadPath = join(tmpdir(), `ad-create-${jobId}.json`);
    await writeFile(payloadPath, JSON.stringify(createPayload), 'utf8');

    const envExtra = { ...getWinRmCredentialEnv() };
    if (!cfg.skipCloudSteps) {
      envExtra.AD_PS_EXO_USER = cfg.exoUser;
      envExtra.AD_PS_EXO_PASSWORD = cfg.exoPassword;
    }

    const { code, stdout, stderr } = await runPowerShellScript(
      cfg.powershellExecutable,
      cfg.createScriptPath,
      payloadPath,
      envExtra,
    );

    logParts.push(stderr, stdout);
    await unlink(payloadPath).catch(() => {});

    let result;
    try {
      result = parseJobResult(stdout);
    } catch {
      throw new Error((stderr || stdout).slice(-4000) || 'Respuesta del script de creación no válida');
    }

    if (!result.ok || code !== 0) {
      throw new Error(result.error || stderr || 'Error en Create-AdAdministrativeUser.ps1');
    }

    administrativeJobStore.completeJob(
      jobId,
      {
        sAMAccountName: result.sAMAccountName,
        userPrincipalName: result.userPrincipalName,
        displayName: result.displayName,
        email: result.email,
        distinguishedName: null,
        message: 'Usuario administrativo creado (PowerShell / Active Directory)',
      },
      logParts.join('\n').slice(-8000),
    );
  } catch (e) {
    const msg = e.message || String(e);
    administrativeJobStore.failJob(jobId, msg, logParts.join('\n').slice(-8000));
  }
}

/**
 * @param {string} jobId
 */
export function getAdministrativeJobStatus(jobId) {
  const j = administrativeJobStore.get(jobId);
  if (!j) return null;
  const base = {
    jobId,
    status: j.status,
    createdAt: j.createdAt,
    result: j.result,
    error: j.error,
  };
  if (process.env.NODE_ENV === 'development' && j.log) {
    return { ...base, log: j.log };
  }
  return base;
}
