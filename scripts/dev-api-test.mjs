import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

// Each browser-test run gets its own DB and rate-limit counters. Never reuse or
// delete the developer's database, and never register under the real API name.
const storage = await mkdtemp(join(tmpdir(), 'stack-e2e-d1-'));
const wrangler = fileURLToPath(
  new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url),
);
const options = ['--config', 'apps/api/wrangler.jsonc', '--persist-to', storage];
let child;
const stop = () => child?.kill('SIGTERM');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
try {
  child = spawn(
    process.execPath,
    [wrangler, 'd1', 'migrations', 'apply', 'DB', '--local', ...options],
    { stdio: 'inherit' },
  );
  const [migrationCode] = await once(child, 'exit');
  if (migrationCode !== 0) throw new Error('テストDBの準備に失敗しました。');
  child = spawn(
    process.execPath,
    [
      wrangler,
      'dev',
      ...options,
      '--name',
      'stack-tetris-api-e2e',
      '--ip',
      '127.0.0.1',
      '--port',
      '8797',
    ],
    { stdio: 'inherit' },
  );
  const [code] = await once(child, 'exit');
  process.exitCode = code ?? 0;
} finally {
  await rm(storage, { recursive: true, force: true });
}
