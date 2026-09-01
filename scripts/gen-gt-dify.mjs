// One-off: generate dify ground-truth JSON (relative paths, no BOM).
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'D:/Develop/dify/web';
const collect = (dir) => {
  const out = [];
  const walk = (p) => {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      const full = join(p, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(full.slice(ROOT.length + 1).replace(/\\/g, '/'));
    }
  };
  walk(dir);
  return out.sort();
};

const signin = [...collect('D:/Develop/dify/web/app/signin'), ...collect('D:/Develop/dify/web/app/components/signin')];
const explore = collect('D:/Develop/dify/web/app/components/explore');

const gt = {
  features: [
    {
      feature: 'signin',
      expectedFiles: signin,
      notExpectedFiles: ['app/signup/page.tsx', 'service/base.ts'],
    },
    {
      feature: 'explore',
      expectedFiles: explore,
      notExpectedFiles: ['app/components/apps/app-card/index.tsx', 'service/base.ts'],
    },
  ],
};

writeFileSync(
  'docs/reports/pr-gt-dify.json',
  JSON.stringify(gt, null, 2),
  'utf8',
);
console.log(`signin: ${signin.length}, explore: ${explore.length}`);
