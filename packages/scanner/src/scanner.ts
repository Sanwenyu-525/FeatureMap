/**
 * Repository scanning (docs/ARCHITECTURE.md §2.1).
 *
 * The scanner does not understand framework semantics; it discovers
 * files, documents and technologies, and computes hashes.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { isAbsolute, join, extname } from 'node:path';
import type { ScannedFile } from '@featuremap/plugin-sdk';
import type { DocumentType } from '@featuremap/core';
import { createIgnoreMatcher } from './ignore.js';
import { hashContent } from './hash.js';

/** Directories never scanned, regardless of configuration (SECURITY.md). */
const ALWAYS_IGNORED = ['.git', '.featuremap', 'node_modules'];

const LANGUAGE_BY_EXT = new Map<string, string>([
  ['.ts', 'TypeScript'],
  ['.tsx', 'TypeScript'],
  ['.mts', 'TypeScript'],
  ['.cts', 'TypeScript'],
  ['.js', 'JavaScript'],
  ['.jsx', 'JavaScript'],
  ['.mjs', 'JavaScript'],
  ['.cjs', 'JavaScript'],
  ['.vue', 'Vue'],
  ['.prisma', 'Prisma'],
  ['.md', 'Markdown'],
  ['.json', 'JSON'],
  ['.yaml', 'YAML'],
  ['.yml', 'YAML'],
]);

export function languageForExtension(ext: string): string | undefined {
  return LANGUAGE_BY_EXT.get(ext.toLowerCase());
}

export interface ScannedDocument {
  path: string;
  type: DocumentType;
  title?: string;
}

export interface TechnologyDetection {
  id: string;
  confidence: number;
  source: string;
}

export interface ScanOutput {
  repoRoot: string;
  files: ScannedFile[];
  documents: ScannedDocument[];
  technologies: TechnologyDetection[];
  currentBranch?: string;
  baseBranch: string;
}

export interface ScanOptions {
  ignore?: string[];
  baseBranch?: string;
}

/** Default document classification (docs/MVP_SPEC.md §10). */
export function classifyDocument(path: string): DocumentType {
  const p = path.toLowerCase();
  const base = p.split('/').pop() ?? p;
  if (base === 'agents.md') return 'agents';
  if (base === 'claude.md') return 'claude';
  if (base === 'contributing.md') return 'contributing';
  if (base.startsWith('readme')) return 'readme';
  if (p.startsWith('docs/adr/') || p.includes('adr')) return 'adr';
  if (p.startsWith('docs/')) return 'docs';
  return 'other';
}

/** Documents that are first-class repository knowledge (docs/MVP_SPEC.md §10). */
export function isDocumentPath(path: string): boolean {
  const p = path.toLowerCase();
  const base = p.split('/').pop() ?? p;
  if (!base.endsWith('.md')) return false;
  if (base === 'agents.md' || base === 'claude.md' || base === 'contributing.md') return true;
  if (base.startsWith('readme')) return true;
  if (p.startsWith('docs/')) return true;
  if (p === '.github/copilot-instructions.md') return true;
  if (p.startsWith('.cursor/rules/')) return true;
  return false;
}

function walkFiles(
  rootDir: string,
  dir: string,
  matcher: { matches(path: string): boolean },
  out: string[],
): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // Unreadable directories are skipped, never fatal (AGENTS.md §3.5).
  }
  for (const entry of entries) {
    const rel = join(dir, entry.name).slice(rootDir.length + 1).replace(/\\/g, '/');
    if (matcher.matches(rel)) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(rootDir, abs, matcher, out);
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
}

/** Detect technologies from package.json and marker files (deterministic, confidence 1.0). */
export function detectTechnologies(repoRoot: string): TechnologyDetection[] {
  const techs: TechnologyDetection[] = [];
  const pkgPath = join(repoRoot, 'package.json');
  let deps: Record<string, string> = {};
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      deps = { ...pkg.dependencies, ...pkg.devDependencies };
    } catch {
      // Malformed package.json is reported by other tooling; not fatal here.
    }
  }
  const depMarkers: Array<[string, string]> = [
    ['react', 'react'],
    ['nextjs', 'next'],
    ['vue', 'vue'],
    ['express', 'express'],
    ['nestjs', '@nestjs/core'],
    ['prisma', '@prisma/client'],
    ['typescript', 'typescript'],
  ];
  for (const [id, dep] of depMarkers) {
    if (deps[dep] !== undefined) {
      techs.push({ id, confidence: 1.0, source: 'package.json' });
    }
  }
  if (existsSync(join(repoRoot, 'tsconfig.json')) && !techs.some((t) => t.id === 'typescript')) {
    techs.push({ id: 'typescript', confidence: 1.0, source: 'tsconfig.json' });
  }
  if (existsSync(join(repoRoot, 'prisma', 'schema.prisma'))) {
    techs.push({ id: 'prisma', confidence: 1.0, source: 'prisma/schema.prisma' });
  }
  return techs;
}

/**
 * Scan a repository root: enumerate eligible files, compute hashes,
 * discover documents and detect technologies.
 */
export function scanRepository(repoRoot: string, options: ScanOptions = {}): ScanOutput {
  const root = isAbsolute(repoRoot) ? repoRoot : join(process.cwd(), repoRoot);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Repository root not found: ${root}`);
  }

  const rules = [...ALWAYS_IGNORED.map((d) => `${d}/**`), ...(options.ignore ?? [])];
  const matcher = createIgnoreMatcher(rules);

  const relPaths: string[] = [];
  walkFiles(root, root, matcher, relPaths);

  const files: ScannedFile[] = [];
  const documents: ScannedDocument[] = [];
  for (const rel of relPaths) {
    const abs = join(root, rel);
    try {
      const content = readFileSync(abs);
      files.push({
        path: rel,
        hash: hashContent(content),
        size: content.length,
        language: languageForExtension(extname(rel)),
      });
      if (isDocumentPath(rel)) {
        documents.push({ path: rel, type: classifyDocument(rel) });
      }
    } catch {
      // Unreadable files are skipped; never fail the whole scan.
    }
  }

  const technologies = detectTechnologies(root);

  return {
    repoRoot: root,
    files,
    documents,
    technologies,
    baseBranch: options.baseBranch ?? 'main',
  };
}
