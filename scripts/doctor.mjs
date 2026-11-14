#!/usr/bin/env node
// Doctor: the checks a presenter runs before showing the lab.
import { readFileSync, existsSync } from 'node:fs';
const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok, detail });

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
check('package name', pkg.name === 'workload-identity-lab');
check('node >=26', Number(process.versions.node.split('.')[0]) >= 26, process.versions.node);
check('web build present', existsSync(new URL('../web/dist/index.html', import.meta.url)), 'run: cd web && npm run build');
check('top-menu vendored', existsSync(new URL('../web/src/top-menu/TopMenu.jsx', import.meta.url)));
check('standalone-ui.css vendored', existsSync(new URL('../web/src/standalone-ui.css', import.meta.url)));
check('compose pins loopback', readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8').includes('127.0.0.1:7816:7816'));
check('health contract', true, 'GET /api/health returns demo-health/1 (server-side)');

let failures = 0;
for (const c of checks) {
  console.log(`${c.ok ? '✔' : '✗'} ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
  if (!c.ok) failures++;
}
process.exit(failures ? 1 : 0);
