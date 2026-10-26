#!/usr/bin/env node
// Guard against committing an unoptimized product photo. Run via
// `npm run check:images`, or automatically on `git push` (see
// .git/hooks/pre-push). Not a build step — just a size tripwire.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'img/products';
const MAX_BYTES = 100 * 1024; // 100KB
const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;

if (!existsSync(DIR)) {
  console.log(`check-image-sizes: ${DIR}/ does not exist yet, nothing to check.`);
  process.exit(0);
}

const offenders = readdirSync(DIR)
  .filter((name) => IMAGE_EXT.test(name))
  .map((name) => {
    const path = join(DIR, name);
    return { name, path, bytes: statSync(path).size };
  })
  .filter((file) => file.bytes > MAX_BYTES);

if (offenders.length === 0) {
  console.log(`check-image-sizes: ok, all files in ${DIR}/ are under ${MAX_BYTES / 1024}KB.`);
  process.exit(0);
}

console.error(`check-image-sizes: ${offenders.length} file(s) in ${DIR}/ exceed ${MAX_BYTES / 1024}KB:\n`);
for (const file of offenders) {
  console.error(`  ${file.path} — ${(file.bytes / 1024).toFixed(0)}KB`);
}
console.error('\nOptimize before committing (e.g. resize + re-export as JPEG quality ~75-80).');
process.exit(1);
