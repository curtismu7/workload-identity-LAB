// The Real-mode connection typed into the page (the Real button's form), kept on a Docker volume so it
// survives a restart. The secret lives only in this one file (mode 600, on the volume): never in the
// repo, the image, the browser, an API response or a log line.
import fs from 'node:fs';
import path from 'node:path';

export const REAL_VARS = ['WI_REAL_GATEWAY_URL', 'WI_REAL_PF_URL', 'WI_REAL_CLIENT_ID', 'WI_REAL_CLIENT_SECRET'];

const file = () => path.join(process.env.WI_CONFIG_DIR || '/data', 'real-connection.json');
const clean = (o) => Object.fromEntries(REAL_VARS.map(k => [k, String(o?.[k] ?? '').trim()]).filter(([, v]) => v));

// Used when the volume cannot be written: the connection then lives for this run only.
let memoryOnly = null;

export function readSaved() {
  if (memoryOnly) return memoryOnly;
  try { return clean(JSON.parse(fs.readFileSync(file(), 'utf8'))); } catch { return {}; }
}

export const isComplete = (v) => REAL_VARS.every(k => v[k]);

// A complete saved connection (typed on the page, the newer choice) wins over the app .env, which is the fallback.
export function effectiveEnv(env = process.env) {
  const saved = readSaved();
  return isComplete(saved) ? { ...env, ...saved } : env;
}

// 'saved' (on the volume), 'memory' (volume not writable), 'env' (the app .env), or null (nothing configured)
export function connectionSource(env = process.env) {
  const saved = readSaved();
  if (isComplete(saved)) return memoryOnly ? 'memory' : 'saved';
  return isComplete(clean(env)) ? 'env' : null;
}

// The three values that are not secret, for prefilling the form: what was saved, else the app .env.
export function formDefaults(env = process.env) {
  const saved = readSaved();
  const pick = (k) => saved[k] || String(env[k] || '').trim();
  return { gatewayUrl: pick('WI_REAL_GATEWAY_URL'), pfUrl: pick('WI_REAL_PF_URL'), clientId: pick('WI_REAL_CLIENT_ID') };
}

// What the page may show about the secret: that one is set and, for a long secret, its last 4 characters
// (enough to tell two secrets apart, never enough to use). Short secrets show no characters at all.
export function secretHint(env = process.env) {
  if (!connectionSource(env)) return { set: false, ends: null };
  const secret = effectiveEnv(env).WI_REAL_CLIENT_SECRET || '';
  return { set: true, ends: secret.length >= 16 ? `…${secret.slice(-4)}` : null };
}

// The saved secret, for a connect that leaves the secret blank to keep it (the page never has it).
export const savedSecret = () => readSaved().WI_REAL_CLIENT_SECRET || '';

export function saveConnection(values) {
  const data = clean(values);
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    const tmp = `${file()}.tmp`;
    fs.rmSync(tmp, { force: true });
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, file());
    memoryOnly = null;
    return { persisted: true };
  } catch (e) {
    memoryOnly = data;
    return { persisted: false, reason: e.code || 'write_failed' };
  }
}

export function forgetConnection() {
  memoryOnly = null;
  try { fs.rmSync(file(), { force: true }); } catch { /* nothing to remove, or not writable: nothing was saved there */ }
}
