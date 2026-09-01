/**
 * Scan benchmark — docs/releases/v0.2-acceptance.md §3 (Performance Gate).
 *
 * Generates a synthetic 1000-file TypeScript repository (a linear
 * import chain plus per-file symbols), then measures:
 * - cold full scan
 * - incremental rescan after touching exactly one file
 *
 * Usage: node scripts/benchmark-scan.mjs [fileCount]
 * Requires the workspace packages to be built (pnpm build).
 */
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runScan } from '../packages/pipeline/dist/index.js';

const fileCount = Number(process.argv[2] ?? 1000);
const root = join(tmpdir(), `featuremap-bench-${fileCount}`);
const dbPath = join(root, '.featuremap', 'bench.db');

rmSync(root, { recursive: true, force: true });
mkdirSync(join(root, 'src'), { recursive: true });
writeFileSync(
  join(root, 'featuremap.yaml'),
  'project:\n  name: bench\nscan:\n  ignore:\n    - .env\n    - .env.*\n',
);

for (let i = 0; i < fileCount; i++) {
  const hasNext = i + 1 < fileCount;
  const body = hasNext ? `import { v } from './file${i + 1}.js';\n` : '';
  const ret = hasNext ? `return v + ${i};` : `return ${i};`;
  writeFileSync(
    join(root, 'src', `file${i}.ts`),
    `${body}export function f${i}(): number {\n  ${ret}\n}\n`,
  );
}

const timing = (ms) => `${Math.round(ms)}ms`;

let t0 = performance.now();
const full = await runScan(root, { dbPath });
const fullMs = performance.now() - t0;

const target = join(root, 'src', `file${Math.floor(fileCount / 2)}.ts`);
writeFileSync(target, readFileSync(target, 'utf8') + '\n// touched\n', 'utf8');

t0 = performance.now();
const incremental = await runScan(root, { dbPath });
const incrementalMs = performance.now() - t0;

const result = {
  files: full.counts.files,
  fullScan: timing(fullMs),
  incrementalScan: timing(incrementalMs),
  changedFiles: incremental.counts.changedFiles,
  cachedFiles: incremental.counts.cachedFiles,
  evidence: full.counts.evidence,
};
console.log(JSON.stringify(result, null, 2));
rmSync(root, { recursive: true, force: true });
