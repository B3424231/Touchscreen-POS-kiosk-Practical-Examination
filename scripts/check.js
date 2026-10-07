import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const files = ['server/database.js', 'server/server.js', 'public/js/cart.js', 'public/js/app.js', 'tests/api.test.js', 'tests/cart.test.js', 'tests/toast.test.js', 'tests/browser.cjs'];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(1); }
}
const html = readFileSync('public/index.html', 'utf8');
for (const match of html.matchAll(/(?:src|href)="(\/[^"#]+)"/g)) {
  if (!existsSync(resolve('public', `.${match[1]}`))) throw new Error(`Missing asset: ${match[1]}`);
}
console.log('Build/static verification passed: JavaScript syntax and HTML asset references. No compilation or bundler is required.');
