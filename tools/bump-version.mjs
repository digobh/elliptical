// Bumps the ?v=N cache-busting number on every import, the stylesheet and the
// footer label, so phones (GitHub Pages caches files ~10 min) load fresh code.
// Usage: npm run bump
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = ['index.html'];
const walk = (d) => readdirSync(d).forEach((f) => {
  const p = join(d, f);
  statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') && files.push(p);
});
walk('src');

const current = Number(readFileSync('index.html', 'utf8').match(/main\.js\?v=(\d+)/)[1]);
const next = current + 1;
for (const f of files) {
  const s = readFileSync(f, 'utf8')
    .replace(/\?v=\d+/g, `?v=${next}`)
    .replace(/(class="[^"]*app-version[^"]*">)v\d+/, `$1v${next}`);
  writeFileSync(f, s);
}
console.log(`Version ${current} → ${next}`);
