import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// 公開ブラウザーの通信ライブラリと、その推移的依存関係の原文を同梱する。
const pending = ['peerjs', 'ws'];
const seen = new Set();
const notices = [
  'テトクラ — サードパーティーライセンス\n各パッケージのライセンス・著作権表示の原文です。\n',
];
while (pending.length) {
  const name = pending.shift();
  if (seen.has(name)) continue;
  seen.add(name);
  const directory = join('node_modules', name);
  const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const files = (await readdir(directory))
    .filter((file) => /^(LICENSE|COPYING|NOTICE)(\.|$)/i.test(file))
    .sort();
  if (!files.length) throw new Error(`${name}: ライセンス原文が見つかりません。`);
  notices.push(`\n${'='.repeat(72)}\n${name} ${pkg.version} — ${pkg.license}\n`);
  for (const file of files) notices.push(await readFile(join(directory, file), 'utf8'));
  pending.push(...Object.keys(pkg.dependencies ?? {}).sort());
}
await writeFile('public/legal/third-party.txt', notices.join('\n'));
console.log(`${seen.size} パッケージのライセンスを生成しました。`);
