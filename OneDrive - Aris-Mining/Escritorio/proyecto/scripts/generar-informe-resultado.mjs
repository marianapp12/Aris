/**
 * Ejecuta Vitest en backend y frontend, genera docs/INFORME_PRUEBAS_ULTIMA_EJECUCION.md
 * con resultados medidos y metadatos Git (commit, árbol sucio, cambio desde informe anterior).
 *
 * Uso (desde la raíz del monorepo): npm run informe:pruebas
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const docs = path.join(root, 'docs');
const statePath = path.join(docs, '.informe-pruebas-estado.json');
const outBackendJson = path.join(docs, '.vitest-last-backend.json');
const outFrontendJson = path.join(docs, '.vitest-last-frontend.json');
const outMd = path.join(docs, 'INFORME_PRUEBAS_ULTIMA_EJECUCION.md');

function git(args) {
  const r = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return { ok: r.status === 0, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

function runVitestJson(cwd, outputFile) {
  const out = path.resolve(outputFile);
  try {
    fs.unlinkSync(out);
  } catch {
    /* no existía */
  }
  const vitestMjs = path.join(cwd, 'node_modules', 'vitest', 'vitest.mjs');
  if (!fs.existsSync(vitestMjs)) {
    console.error('No se encontró vitest en:', vitestMjs, '(ejecute npm ci en esa carpeta)');
    return false;
  }
  /**
   * `verbose` lista cada caso en consola (evidencia tipo captura de terminal).
   * `json` + `--outputFile` alimenta el Markdown; `node …/vitest.mjs` evita npx/.cmd en Windows con rutas con espacios.
   */
  spawnSync(process.execPath, [
    vitestMjs,
    'run',
    '--reporter=verbose',
    '--reporter=json',
    '--outputFile',
    out,
  ], {
    cwd,
    encoding: 'utf8',
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  /** Vitest suele escribir el JSON aunque haya pruebas fallidas (exit ≠ 0); basta con que el archivo exista. */
  return fs.existsSync(out);
}

function parseVitestFile(jsonPath, projectRootForRelative) {
  if (!fs.existsSync(jsonPath)) {
    return null;
  }
  const raw = fs.readFileSync(jsonPath, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const files = (data.testResults || []).map((tr) => {
    const rel = path.relative(projectRootForRelative, tr.name).replace(/\\/g, '/');
    const tests = (tr.assertionResults || []).map((a) => ({
      suite: (a.ancestorTitles || []).join(' › '),
      title: a.title,
      status: a.status,
      durationMs: typeof a.duration === 'number' ? Math.round(a.duration * 100) / 100 : 0,
      failures: a.failureMessages || [],
    }));
    return { file: rel || path.basename(tr.name), status: tr.status, tests };
  });
  return {
    success: Boolean(data.success),
    numPassedTests: data.numPassedTests ?? 0,
    numFailedTests: data.numFailedTests ?? 0,
    numTotalTests: data.numTotalTests ?? 0,
    startTime: data.startTime,
    files,
  };
}

function esc(s) {
  return String(s || '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

/** Agrega duraciones por caso (ms) a partir del JSON parseado de Vitest. */
function aggregateDurations(parsed) {
  if (!parsed?.files?.length) {
    return null;
  }
  let sum = 0;
  let count = 0;
  let max = 0;
  let slowest = null;
  for (const f of parsed.files) {
    for (const t of f.tests) {
      const ms = typeof t.durationMs === 'number' ? t.durationMs : 0;
      sum += ms;
      count += 1;
      if (ms >= max) {
        max = ms;
        slowest = { file: f.file, suite: t.suite, title: t.title, ms };
      }
    }
  }
  const round2 = (n) => Math.round(n * 100) / 100;
  return {
    sum: round2(sum),
    count,
    mean: count ? round2(sum / count) : 0,
    max: round2(max),
    slowest,
  };
}

function markdownDurationSummary(label, agg) {
  const lines = [];
  lines.push(`### ${label}`);
  lines.push('');
  if (!agg || agg.count === 0) {
    lines.push('*Sin datos de duración.*');
    lines.push('');
    return lines;
  }
  lines.push('| Métrica | Valor |');
  lines.push('|---------|--------|');
  lines.push(`| Casos contabilizados | **${agg.count}** |`);
  lines.push(`| Suma de duraciones (ms) | **${agg.sum}** |`);
  lines.push(`| Media por caso (ms) | **${agg.mean}** |`);
  lines.push(`| Máximo por caso (ms) | **${agg.max}** |`);
  if (agg.slowest) {
    lines.push(
      '| Caso más lento | `' +
        esc(agg.slowest.file) +
        '` — ' +
        esc(agg.slowest.title) +
        ' — **' +
        agg.slowest.ms +
        '** ms |'
    );
  }
  lines.push('');
  return lines;
}

function main() {
  fs.mkdirSync(docs, { recursive: true });

  const prevState = fs.existsSync(statePath)
    ? JSON.parse(fs.readFileSync(statePath, 'utf8'))
    : null;

  const head = git(['rev-parse', 'HEAD']);
  const short = git(['rev-parse', '--short', 'HEAD']);
  const dirty = git(['status', '--porcelain']);
  const isDirty = dirty.stdout.length > 0;
  const currentHead = head.ok ? head.stdout : '(git no disponible)';
  const currentShort = short.ok ? short.stdout : '?';

  const dirtyLines = dirty.stdout ? dirty.stdout.split('\n').filter(Boolean) : [];
  const dirtySummary =
    dirtyLines.length === 0
      ? 'No: el árbol de trabajo coincide con el índice (sin archivos pendientes de commit según `git status`).'
      : `Sí: hay **${dirtyLines.length}** entrada(s) en ` + '`git status --porcelain` (cambios locales no confirmados).';

  let changeVsPrevious = '**N/A** — no había un informe anterior registrado en `.informe-pruebas-estado.json`.';
  if (prevState?.gitHead && head.ok) {
    if (prevState.gitHead === currentHead) {
      changeVsPrevious =
        '**No** — el commit HEAD es el mismo que al generar el informe anterior (`' +
        currentShort +
        '`).';
    } else {
      changeVsPrevious =
        '**Sí** — el HEAD actual (`' +
        currentShort +
        '`) difiere del commit guardado en el informe anterior (`' +
        String(prevState.gitShort || prevState.gitHead).slice(0, 7) +
        '…`).';
    }
  }

  console.log('\n--- Vitest backend ---\n');
  runVitestJson(path.join(root, 'backend'), outBackendJson);
  console.log('\n--- Vitest frontend ---\n');
  runVitestJson(path.join(root, 'frontend'), outFrontendJson);

  const backend = parseVitestFile(outBackendJson, path.join(root, 'backend'));
  const frontend = parseVitestFile(outFrontendJson, path.join(root, 'frontend'));

  const genAt = new Date().toISOString();
  const genAtLocal = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });

  const lines = [];
  lines.push('# Resultado de la última ejecución de pruebas');
  lines.push('');
  lines.push('> **Archivo generado automáticamente.** No editarlo a mano: se sobrescribe al ejecutar `npm run informe:pruebas` desde la raíz del monorepo.');
  lines.push('');
  lines.push('## 1. Metadatos y estado del repositorio');
  lines.push('');
  lines.push('| Campo | Valor |');
  lines.push('|--------|--------|');
  lines.push(`| Fecha y hora (generación del informe) | ${genAt} (ISO) / ${genAtLocal} (America/Bogota) |`);
  lines.push(`| Commit actual (HEAD) | \`${currentHead}\` (corto: \`${currentShort}\`) |`);
  lines.push(
    '| ¿Hay cambios locales sin commit? | ' + dirtySummary + ' |'
  );
  lines.push('| ¿Cambió el commit respecto al informe anterior? | ' + changeVsPrevious + ' |');
  if (prevState?.generatedAt) {
    lines.push(`| Informe anterior generado | ${prevState.generatedAt} |`);
  }
  lines.push('');

  function section(heading, label, parsed) {
    lines.push(`## ${heading}`);
    lines.push('');
    if (!parsed) {
      lines.push(
        `**Estado:** **ERROR** — no se pudo ejecutar Vitest o leer el JSON de salida en **${label}**.`
      );
      lines.push('');
      return;
    }
    const estado = parsed.success && parsed.numFailedTests === 0 ? '**PASS**' : '**FAIL**';
    lines.push(
      `**Estado global:** ${estado} · Pruebas: **${parsed.numPassedTests}** pasadas, **${parsed.numFailedTests}** fallidas, total **${parsed.numTotalTests}**.`
    );
    lines.push('');
    lines.push('| Archivo de test | Casos | Estado archivo |');
    lines.push('|------------------|-------|----------------|');
    for (const f of parsed.files) {
      const n = f.tests.length;
      const failed = f.tests.filter((t) => t.status !== 'passed').length;
      const st = failed > 0 || f.status !== 'passed' ? 'Con fallos' : 'OK';
      lines.push(`| \`${esc(f.file)}\` | ${n} | ${st} |`);
    }
    lines.push('');
    lines.push('### Detalle por caso');
    lines.push('');
    lines.push('| Archivo | Suite | Caso (`it`) | Resultado | ms |');
    lines.push('|---------|-------|-------------|-------------|-----|');
    for (const f of parsed.files) {
      for (const t of f.tests) {
        const res = t.status === 'passed' ? '**Exitoso**' : `**${t.status}**`;
        const failNote =
          t.failures && t.failures.length
            ? '<br><small>' + esc(t.failures.join('; ')).slice(0, 200) + '</small>'
            : '';
        lines.push(
          `| \`${esc(f.file)}\` | ${esc(t.suite)} | ${esc(t.title)} | ${res}${failNote} | ${t.durationMs} |`
        );
      }
    }
    lines.push('');
  }

  section('2. Backend (`backend/`)', 'backend', backend);
  section('3. Frontend (`frontend/`)', 'frontend', frontend);

  const aggBackend = aggregateDurations(backend);
  const aggFrontend = aggregateDurations(frontend);
  const aggGlobal =
    aggBackend && aggFrontend && aggBackend.count + aggFrontend.count > 0
      ? {
          sum: Math.round((aggBackend.sum + aggFrontend.sum) * 100) / 100,
          count: aggBackend.count + aggFrontend.count,
          mean:
            Math.round(
              ((aggBackend.sum + aggFrontend.sum) / (aggBackend.count + aggFrontend.count)) * 100
            ) / 100,
          max: Math.max(aggBackend.max, aggFrontend.max),
        }
      : null;

  lines.push('## 4. Resumen cuantitativo (duración Vitest)');
  lines.push('');
  lines.push(
    'Los valores se calculan en esta misma corrida a partir de las duraciones por caso que reporta Vitest en el JSON interno (misma ejecución que el detalle de las secciones 2 y 3).'
  );
  lines.push('');
  lines.push(...markdownDurationSummary('Backend', aggBackend));
  lines.push(...markdownDurationSummary('Frontend', aggFrontend));
  if (aggGlobal) {
    lines.push('### Global (backend + frontend)');
    lines.push('');
    lines.push('| Métrica | Valor |');
    lines.push('|---------|--------|');
    lines.push(`| Total de casos | **${aggGlobal.count}** |`);
    lines.push(`| Suma de duraciones (ms) | **${aggGlobal.sum}** |`);
    lines.push(`| Media por caso (ms) | **${aggGlobal.mean}** |`);
    lines.push(
      '| Máximo entre casos (ms) | **' +
        aggGlobal.max +
        '** (el máximo individual aparece en la subsección del paquete correspondiente) |'
    );
    lines.push('');
  }

  lines.push('## 5. Cómo regenerar');
  lines.push('');
  lines.push('Desde la carpeta raíz del monorepo:');
  lines.push('');
  lines.push('```bash');
  lines.push('npm run informe:pruebas');
  lines.push('```');
  lines.push('');
  lines.push('Requisitos: `git` en PATH, dependencias instaladas (`npm ci` en `backend/` y `frontend/`).');
  lines.push('');
  lines.push(
    'Vitest se invoca con **`--reporter=verbose`** (listado en consola) y **`--reporter=json`** (para este Markdown).'
  );
  lines.push('');
  lines.push(
    'Si hay casos fallidos, el informe muestra **FAIL** y el detalle por caso; el comando `npm run informe:pruebas` termina con código de salida **1** hasta que todas las pruebas pasen.'
  );
  lines.push('');

  fs.writeFileSync(outMd, lines.join('\n'), 'utf8');

  const newState = {
    gitHead: currentHead,
    gitShort: currentShort,
    generatedAt: genAt,
    backendSuccess: backend?.success ?? false,
    frontendSuccess: frontend?.success ?? false,
  };
  fs.writeFileSync(statePath, JSON.stringify(newState, null, 2), 'utf8');

  try {
    fs.unlinkSync(outBackendJson);
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(outFrontendJson);
  } catch {
    /* ignore */
  }

  console.log('\nInforme escrito en:', outMd);
  console.log('Estado guardado en:', statePath);

  const backendOk =
    backend && backend.success === true && backend.numFailedTests === 0;
  const frontendOk =
    frontend && frontend.success === true && frontend.numFailedTests === 0;
  const exitCode = backend && frontend && backendOk && frontendOk ? 0 : 1;
  if (exitCode !== 0) {
    console.error('\nInforme generado con advertencias o fallos en pruebas (código de salida 1).');
  }
  process.exit(exitCode);
}

main();
