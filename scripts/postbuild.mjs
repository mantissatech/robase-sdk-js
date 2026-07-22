// The package is ESM ("type": "module"), so Node would otherwise read the CJS
// output as ESM and fail on `require`. A per-directory package.json marker
// pins each build to the right module system.
import { writeFileSync } from 'node:fs';

writeFileSync('dist/esm/package.json', JSON.stringify({ type: 'module' }, null, 2) + '\n');
writeFileSync('dist/cjs/package.json', JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');

console.log('postbuild: wrote module-type markers to dist/esm and dist/cjs');
