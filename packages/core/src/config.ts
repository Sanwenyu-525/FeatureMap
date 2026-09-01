import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { DEFAULT_MINIMUM_IMPACT_CONFIDENCE } from './confidence.js';

/** Name of the project configuration file (docs/MVP_SPEC.md §6). */
export const CONFIG_FILE_NAME = 'featuremap.yaml';

/** Runtime/cache directory created by `featuremap init` (docs/MVP_SPEC.md §6). */
export const RUNTIME_DIR_NAME = '.featuremap';

/** Default local web/API port (docs/MVP_SPEC.md §6, docs/API_SPEC.md §1). */
export const DEFAULT_WEB_PORT = 7331;

/**
 * Analyzer identifiers enabled in the MVP
 * (docs/MVP_SPEC.md, docs/ANALYZER_PLUGIN_SPEC.md §3).
 */
export const MVP_ANALYZER_IDS = [
  'typescript',
  'react',
  'nextjs',
  'vue',
  'express',
  'nestjs',
  'prisma',
  'markdown',
  'cli',
] as const;

export type AnalyzerId = (typeof MVP_ANALYZER_IDS)[number];

export interface FeatureMapConfig {
  project: {
    name: string;
  };
  scan: {
    baseBranch: string;
    ignore: string[];
  };
  analyzers: {
    enabled: AnalyzerId[];
  };
  features: {
    seeds: string[];
  };
  llm: {
    enabled: boolean;
    provider: string;
  };
  web: {
    port: number;
  };
  impact: {
    minimumConfidence: number;
  };
}

export interface ConfigIssue {
  level: 'warning' | 'error';
  code: string;
  message: string;
}

export interface ConfigLoadResult {
  config?: FeatureMapConfig;
  issues: ConfigIssue[];
}

/** Ignore rules that SECURITY.md mandates by default. */
export const MANDATORY_IGNORE_RULES = ['.env', '.env.*'];

export const DEFAULT_IGNORE_RULES = [
  'node_modules/**',
  'dist/**',
  'build/**',
  'coverage/**',
  '.next/**',
  '.git/**',
  '.env',
  '.env.*',
  // Fixture repositories are test inputs, not product features
  // (found during dogfooding: they otherwise produce noise features).
  'test-fixtures/**',
];

/** Produce the default configuration used by `featuremap init`. */
export function defaultConfig(projectName: string): FeatureMapConfig {
  return {
    project: { name: projectName },
    scan: { baseBranch: 'main', ignore: [...DEFAULT_IGNORE_RULES] },
    analyzers: { enabled: [...MVP_ANALYZER_IDS] },
    features: { seeds: [] },
    llm: { enabled: true, provider: 'openai' },
    web: { port: DEFAULT_WEB_PORT },
    impact: { minimumConfidence: DEFAULT_MINIMUM_IMPACT_CONFIDENCE },
  };
}

/**
 * Validate a parsed configuration object against MVP rules.
 * Returns issues instead of throwing so `featuremap doctor` can report
 * every problem at once.
 */
export function validateConfig(input: unknown): { config?: FeatureMapConfig; issues: ConfigIssue[] } {
  const issues: ConfigIssue[] = [];
  if (input === null || typeof input !== 'object') {
    return {
      issues: [{ level: 'error', code: 'INVALID_CONFIG', message: 'Configuration must be a mapping.' }],
    };
  }
  const raw = input as Record<string, unknown>;

  const projectName =
    typeof raw['project'] === 'object' && raw['project'] !== null
      ? (raw['project'] as Record<string, unknown>)['name']
      : undefined;
  if (typeof projectName !== 'string' || projectName.trim() === '') {
    issues.push({ level: 'error', code: 'INVALID_CONFIG', message: 'project.name is required.' });
  }

  const scan = (typeof raw['scan'] === 'object' && raw['scan'] !== null ? raw['scan'] : {}) as Record<string, unknown>;
  const baseBranch = typeof scan['baseBranch'] === 'string' ? scan['baseBranch'] : 'main';
  const ignore = Array.isArray(scan['ignore'])
    ? scan['ignore'].filter((r): r is string => typeof r === 'string')
    : [...DEFAULT_IGNORE_RULES];
  for (const mandatory of MANDATORY_IGNORE_RULES) {
    if (!ignore.includes(mandatory)) {
      issues.push({
        level: 'error',
        code: 'MISSING_MANDATORY_IGNORE',
        message: `scan.ignore must include "${mandatory}" (see SECURITY.md).`,
      });
    }
  }

  const analyzers = (typeof raw['analyzers'] === 'object' && raw['analyzers'] !== null ? raw['analyzers'] : {}) as Record<string, unknown>;
  const enabledAnalyzers = Array.isArray(analyzers['enabled'])
    ? analyzers['enabled'].filter((a): a is AnalyzerId =>
        typeof a === 'string' && (MVP_ANALYZER_IDS as readonly string[]).includes(a),
      )
    : [...MVP_ANALYZER_IDS];

  const features = (typeof raw['features'] === 'object' && raw['features'] !== null ? raw['features'] : {}) as Record<string, unknown>;
  const seeds = Array.isArray(features['seeds'])
    ? features['seeds'].filter((s): s is string => typeof s === 'string')
    : [];

  const llm = (typeof raw['llm'] === 'object' && raw['llm'] !== null ? raw['llm'] : {}) as Record<string, unknown>;
  const llmEnabled = typeof llm['enabled'] === 'boolean' ? llm['enabled'] : false;
  const llmProvider = typeof llm['provider'] === 'string' ? llm['provider'] : 'openai';

  const web = (typeof raw['web'] === 'object' && raw['web'] !== null ? raw['web'] : {}) as Record<string, unknown>;
  const port = typeof web['port'] === 'number' && Number.isInteger(web['port']) && web['port'] > 0 && web['port'] < 65536
    ? web['port']
    : DEFAULT_WEB_PORT;

  const impact = (typeof raw['impact'] === 'object' && raw['impact'] !== null ? raw['impact'] : {}) as Record<string, unknown>;
  let minimumConfidence = DEFAULT_MINIMUM_IMPACT_CONFIDENCE;
  if (typeof impact['minimumConfidence'] === 'number') {
    const v = impact['minimumConfidence'];
    if (v >= 0.5 && v <= 1) {
      minimumConfidence = v;
    } else {
      issues.push({
        level: 'error',
        code: 'INVALID_CONFIG',
        message: 'impact.minimumConfidence must be within [0.5, 1]: below 0.5 evidence must not be surfaced (DATA_MODEL.md §4).',
      });
    }
  }

  const hasErrors = issues.some((i) => i.level === 'error');
  if (hasErrors && typeof projectName !== 'string') {
    return { issues };
  }

  return {
    config: {
      project: { name: projectName as string },
      scan: { baseBranch, ignore },
      analyzers: { enabled: enabledAnalyzers },
      features: { seeds },
      llm: { enabled: llmEnabled, provider: llmProvider },
      web: { port },
      impact: { minimumConfidence },
    },
    issues,
  };
}

/** Load and validate `featuremap.yaml` from a repository root. */
export function loadConfig(repoRoot: string): ConfigLoadResult {
  const configPath = join(repoRoot, CONFIG_FILE_NAME);
  let text: string;
  try {
    text = readFileSync(configPath, 'utf8');
  } catch {
    return {
      issues: [
        { level: 'error', code: 'PROJECT_NOT_INITIALIZED', message: `${CONFIG_FILE_NAME} not found in ${repoRoot}. Run "featuremap init" first.` },
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (err) {
    return {
      issues: [
        { level: 'error', code: 'INVALID_CONFIG', message: `Failed to parse ${CONFIG_FILE_NAME}: ${err instanceof Error ? err.message : String(err)}` },
      ],
    };
  }

  return validateConfig(parsed);
}
