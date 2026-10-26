// Starts the application for Playwright: builds the web app, creates a fresh local D1 database
// with the real migrations, then runs the Worker (E2E entry, controllable clock) on port 8788.
import { rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const api = resolve(root, 'workers/api');
const state = resolve(api, '.wrangler/e2e-state');
const port = process.env.E2E_PORT ?? '8788';
const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: true });

rmSync(state, { recursive: true, force: true });
let r = run('npm', ['run', 'build', '-w', '@mummer/web'], root);
if (r.status !== 0) process.exit(r.status ?? 1);
r = run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'mummer', '--local', '--persist-to', state, '-c', 'wrangler.e2e.toml'], api);
if (r.status !== 0) process.exit(r.status ?? 1);

const child = spawn('npx', ['wrangler', 'dev', '-c', 'wrangler.e2e.toml', '--local', '--persist-to', state, '--port', port, '--ip', '127.0.0.1'], { cwd: api, stdio: 'inherit', shell: true });
const stop = () => {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));
