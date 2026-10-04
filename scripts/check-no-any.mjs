import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = 'packages/engine/src';
const bad = [];

function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(f)) {
      readFileSync(p, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/(:\s*any\b|\bas any\b|<any>|\bany\[\])/.test(line)) {
            bad.push(`${p}:${i + 1}: ${line.trim()}`);
          }
        });
    }
  }
}

walk(root);

if (bad.length) {
  console.error('`any` is banned in packages/engine:\n' + bad.join('\n'));
  process.exit(1);
}

console.log('no-any check: ok');