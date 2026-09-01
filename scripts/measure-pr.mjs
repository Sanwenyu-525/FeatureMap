/**
 * Real-project Precision/Recall measurement — docs/releases/v0.2-acceptance.md §14.
 *
 * Usage: node scripts/measure-pr.mjs <repoRoot> <groundTruthJson>
 *
 * The ground-truth JSON maps human-labeled features to expectedFiles /
 * notExpectedFiles. For each feature the script collects the file
 * candidates the anchor-driven engine produced (status != rejected),
 * reports TP / FP / FN with the exact misclassified files, and prints
 * precision / recall. Unclassified candidates (neither expected nor
 * notExpected) are listed separately for the labeler and counted as
 * false positives (precision-first).
 *
 * Requires `pnpm build` (imports the compiled pipeline).
 */
import { readFileSync } from 'node:fs';
import { runScan } from '../packages/pipeline/dist/index.js';

const [repoRoot, gtPath] = process.argv.slice(2);
if (!repoRoot || !gtPath) {
  console.error('Usage: node scripts/measure-pr.mjs <repoRoot> <groundTruthJson>');
  process.exit(1);
}

const gt = JSON.parse(readFileSync(gtPath, 'utf8'));
const scan = await runScan(repoRoot, {});

const rows = [];
for (const truth of gt.features) {
  const featureId = `feature:${truth.feature}`;
  const candidates = scan.candidates
    .filter((c) => c.featureId === featureId && c.targetType === 'file' && c.status !== 'rejected')
    .map((c) => c.targetId)
    .sort();

  const expectedSet = new Set(truth.expectedFiles);
  const notExpectedSet = new Set(truth.notExpectedFiles);
  const candidateSet = new Set(candidates);

  const tp = candidates.filter((c) => expectedSet.has(c));
  const fp = candidates.filter((c) => !expectedSet.has(c));
  const unclassified = fp.filter((c) => !notExpectedSet.has(c));
  const fn = truth.expectedFiles.filter((e) => !candidateSet.has(e));
  const precision = candidates.length === 0 ? 1 : tp.length / candidates.length;
  const recall = truth.expectedFiles.length === 0 ? 1 : tp.length / truth.expectedFiles.length;

  rows.push({ feature: truth.feature, candidates, tp, fp, unclassified, fn, precision, recall });
}

const strictPrecision = rows.reduce((s, r) => s + r.precision, 0) / rows.length;
const recall = rows.reduce((s, r) => s + r.recall, 0) / rows.length;

const report = {
  repo: repoRoot,
  scannedFiles: scan.counts.files,
  features: rows.map((r) => ({
    feature: r.feature,
    precision: Number((r.precision * 100).toFixed(1)),
    recall: Number((r.recall * 100).toFixed(1)),
    candidates: r.candidates,
    falsePositives: r.fp,
    falseNegatives: r.fn,
    unclassified: r.unclassified,
  })),
  average: {
    precision: Number((strictPrecision * 100).toFixed(1)),
    recall: Number((recall * 100).toFixed(1)),
  },
};

console.log(JSON.stringify(report, null, 2));

// Human-readable summary
console.error('\n=== Per-feature summary ===');
for (const r of rows) {
  console.error(
    `${r.feature.padEnd(22)} P=${(r.precision * 100).toFixed(0)}% R=${(r.recall * 100).toFixed(0)}%` +
      ` candidates=${r.candidates.length} fp=${r.fp.length} fn=${r.fn.length} unclassified=${r.unclassified.length}`,
  );
}
console.error(
  `\nAverage precision=${(strictPrecision * 100).toFixed(1)}% recall=${(recall * 100).toFixed(1)}% over ${rows.length} features`,
);
