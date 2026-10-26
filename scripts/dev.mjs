// One command for local development: `npm run dev`.
// Creates a gitignored .dev.vars if missing, applies the migrations to a local throwaway D1, then runs
// the Worker (API, port 8787) and the Vite dev server (web app with hot reload, port 5173, /api proxied).
// Open http://localhost:5173. Nothing here touches Cloudflare: both run locally.
import { existsSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const api = resolve(root, 'workers/api');
const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: true });

const vars = resolve(api, '.dev.vars');
if (!existsSync(vars)) {
  // Development relaxes the human check (no Turnstile keys locally). The salt is a local, non-secret value.
  writeFileSync(vars, 'ENVIRONMENT=development\nBUILD_COMMIT=local\nRATE_LIMIT_SALT=local-dev-salt\n');
  console.log('Created workers/api/.dev.vars (gitignored).');
}

const migrated = run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'mummer', '--local'], api);
if (migrated.status !== 0) process.exit(migrated.status ?? 1);

const children = [
  spawn('npx', ['wrangler', 'dev', '--local', '--port', '8787', '--ip', '127.0.0.1'], { cwd: api, stdio: 'inherit', shell: true }),
  spawn('npx', ['vite', '--host', '127.0.0.1'], { cwd: resolve(root, 'apps/web'), stdio: 'inherit', shell: true }),
];

let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
    else c.kill('SIGTERM');
  }
  process.exit(code);
};
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
for (const c of children) c.on('exit', (code) => stop(code ?? 0));
console.log('\nMummer is starting. Open http://127.0.0.1:5173 once both servers report ready.\n');
