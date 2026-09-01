import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CONFIG_FILE_NAME,
  defaultConfig,
  loadConfig,
  validateConfig,
} from '../src/config.js';

const tempRoots: string[] = [];

function makeTempRepo(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'featuremap-config-'));
  tempRoots.push(dir);
  writeFileSync(join(dir, CONFIG_FILE_NAME), yaml, 'utf8');
  return dir;
}

afterAll(() => {
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
});

describe('defaultConfig', () => {
  it('uses the documented defaults (docs/featuremap.example.yaml)', () => {
    const config = defaultConfig('demo');
    expect(config.web.port).toBe(7331);
    expect(config.scan.baseBranch).toBe('main');
    expect(config.impact.minimumConfidence).toBe(0.65);
    expect(config.scan.ignore).toContain('.env');
    expect(config.scan.ignore).toContain('.env.*');
    // Rust/Tauri build output must never be scanned (real-repo finding).
    expect(config.scan.ignore).toContain('target/**');
    expect(config.analyzers.enabled).toContain('typescript');
    expect(config.analyzers.enabled).toContain('markdown');
    // Phase 3 git window (Milestone 10).
    expect(config.git.logLimit).toBe(200);
  });
});

describe('validateConfig', () => {
  it('accepts the example configuration', () => {
    const { config, issues } = validateConfig({
      project: { name: 'demo' },
      scan: { baseBranch: 'main', ignore: ['.env', '.env.*'] },
      analyzers: { enabled: ['typescript'] },
      features: { seeds: [] },
      llm: { enabled: true, provider: 'openai' },
      web: { port: 7331 },
      impact: { minimumConfidence: 0.65 },
    });
    expect(issues).toEqual([]);
    expect(config?.project.name).toBe('demo');
  });

  it('rejects ignore rules missing mandatory .env entries (SECURITY.md)', () => {
    const { config, issues } = validateConfig({
      project: { name: 'demo' },
      scan: { baseBranch: 'main', ignore: ['node_modules/**'] },
    });
    expect(config).toBeDefined();
    expect(issues.some((i) => i.code === 'MISSING_MANDATORY_IGNORE')).toBe(true);
  });

  it('rejects impact.minimumConfidence below 0.5 (docs/DATA_MODEL.md §4)', () => {
    const { issues } = validateConfig({
      project: { name: 'demo' },
      impact: { minimumConfidence: 0.3 },
    });
    expect(issues.some((i) => i.level === 'error' && i.code === 'INVALID_CONFIG')).toBe(true);
  });

  it('parses git.logLimit and rejects out-of-range values', () => {
    const ok = validateConfig({ project: { name: 'demo' }, git: { logLimit: 500 } });
    expect(ok.config?.git.logLimit).toBe(500);
    const bad = validateConfig({ project: { name: 'demo' }, git: { logLimit: 0 } });
    expect(bad.issues.some((i) => i.level === 'error' && i.code === 'INVALID_CONFIG')).toBe(true);
  });

  it('rejects a non-mapping configuration', () => {
    const { config, issues } = validateConfig('nope');
    expect(config).toBeUndefined();
    expect(issues[0]?.code).toBe('INVALID_CONFIG');
  });
});

describe('loadConfig', () => {
  it('loads a valid featuremap.yaml from the repo root', () => {
    const root = makeTempRepo(
      [
        'project:',
        '  name: demo',
        'scan:',
        '  baseBranch: main',
        '  ignore:',
        '    - .env',
        '    - .env.*',
        'impact:',
        '  minimumConfidence: 0.7',
      ].join('\n'),
    );
    const { config, issues } = loadConfig(root);
    expect(issues).toEqual([]);
    expect(config?.impact.minimumConfidence).toBe(0.7);
  });

  it('reports PROJECT_NOT_INITIALIZED when the config file is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'featuremap-empty-'));
    tempRoots.push(root);
    const { config, issues } = loadConfig(root);
    expect(config).toBeUndefined();
    expect(issues[0]?.code).toBe('PROJECT_NOT_INITIALIZED');
  });

  it('reports INVALID_CONFIG for malformed YAML', () => {
    const root = makeTempRepo('project: [unclosed');
    const { issues } = loadConfig(root);
    expect(issues[0]?.code).toBe('INVALID_CONFIG');
  });
});
