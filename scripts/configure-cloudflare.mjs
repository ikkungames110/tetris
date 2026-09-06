import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'jsonc-parser';

async function readConfig(path) {
  const errors = [];
  const config = parse(await readFile(path, 'utf8'), errors, { allowTrailingComma: true });
  if (errors.length) throw new Error(`${path} のJSONCが不正です。`);
  return config;
}

// Resource identifiers are configuration, never credentials. Tokens stay in
// Wrangler's login storage or GitHub Secrets, not in Vite's public environment.
const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
if (
  !databaseId ||
  !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(databaseId) ||
  databaseId === '00000000-0000-0000-0000-000000000000'
) {
  throw new Error('実際の CLOUDFLARE_D1_DATABASE_ID を設定してください。');
}
const pages = await readConfig('wrangler.jsonc');
const api = await readConfig('apps/api/wrangler.jsonc');
for (const [value, label] of [
  [process.env.CLOUDFLARE_PAGES_PROJECT, 'Pages'],
  [process.env.CLOUDFLARE_WORKER_NAME, 'Worker'],
]) {
  if (value && !/^[a-z0-9][a-z0-9-]{0,57}[a-z0-9]$/.test(value))
    throw new Error(`${label}名が不正です。`);
}
api.d1_databases[0].database_id = databaseId;
if (process.env.CLOUDFLARE_PAGES_PROJECT) pages.name = process.env.CLOUDFLARE_PAGES_PROJECT;
if (process.env.CLOUDFLARE_WORKER_NAME) api.name = process.env.CLOUDFLARE_WORKER_NAME;
pages.services[0].service = api.name;
await writeFile('wrangler.jsonc', JSON.stringify(pages, null, 2) + '\n');
await writeFile('apps/api/wrangler.jsonc', JSON.stringify(api, null, 2) + '\n');
console.log('Cloudflare の公開先設定を更新しました。');
