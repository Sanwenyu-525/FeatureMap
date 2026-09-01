/**
 * FeatureMap CLI (docs/MVP_SPEC.md §6).
 *
 * Milestone 0 scope: `init` and `doctor` are functional; `scan`,
 * `feature`, `impact` and `dev` are command-shape placeholders that
 * will be implemented in Milestones 1–4 (docs/DEVELOPMENT_PLAN.md).
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { Command } from 'commander';
import { $ } from 'execa';
import { stringify as stringifyYaml } from 'yaml';
import {
  CONFIG_FILE_NAME,
  RUNTIME_DIR_NAME,
  defaultConfig,
  loadConfig,
  type ConfigIssue,
} from '@featuremap/core';
import { runScan } from '@featuremap/pipeline';

const program = new Command();

program
  .name('featuremap')
  .description('Local-first codebase intelligence organized by product feature.')
  .version('0.0.1');

/** Print configuration issues in a stable, machine-readable form. */
function printIssues(issues: ConfigIssue[]): void {
  for (const issue of issues) {
    const line = `${issue.level}: ${issue.code} ${issue.message}`;
    if (issue.level === 'error') {
      console.error(line);
    } else {
      console.warn(line);
    }
  }
}

program
  .command('init')
  .description('Create featuremap.yaml and the .featuremap runtime directory.')
  .action(() => {
    const repoRoot = process.cwd();
    const configPath = join(repoRoot, CONFIG_FILE_NAME);
    if (existsSync(configPath)) {
      console.log(`${CONFIG_FILE_NAME} already exists; leaving it unchanged.`);
      return;
    }
    const config = defaultConfig(basename(resolve(repoRoot)));
    writeFileSync(configPath, stringifyYaml(config), 'utf8');
    mkdirSync(join(repoRoot, RUNTIME_DIR_NAME), { recursive: true });
    console.log(`Created ${CONFIG_FILE_NAME}`);
    console.log(`Created ${RUNTIME_DIR_NAME}/`);
  });

program
  .command('scan')
  .description('Scan the repository and update the local evidence index.')
  .option('--json', 'emit machine-readable JSON output')
  .option('--full', 'force a full rescan')
  .option('--no-llm', 'disable semantic analysis for this run')
  .action(async (opts: { json?: boolean; full?: boolean }) => {
    try {
      const repoRoot = process.cwd();
      const result = await runScan(repoRoot, { json: opts.json, full: opts.full });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Project: ${result.project.name}`);
        console.log(`Branch: ${result.project.currentBranch ?? 'unknown'}`);
        console.log('');
        console.log('Technologies');
        for (const t of result.technologies) console.log(`✓ ${t.id}`);
        console.log('');
        console.log(`Files: ${result.counts.files}`);
        console.log(`Symbols: ${result.counts.symbols}`);
        console.log(`Endpoints: ${result.counts.endpoints}`);
        console.log(`Documents: ${result.counts.documents}`);
        console.log(`Evidence: ${result.counts.evidence}`);
        console.log(`Commits: ${result.counts.commits}`);
        console.log('');
        console.log('Analyzers');
        for (const run of result.runs) console.log(`✓ ${run.analyzerId}: ${run.status}`);
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

program
  .command('dev')
  .description('Start the local API and Web UI.')
  .action(async () => {
    try {
      const repoRoot = process.cwd();
      const loaded = loadConfig(repoRoot);
      if (!loaded.config) {
        const first = loaded.issues.find((i) => i.level === 'error') ?? loaded.issues[0];
        console.error(first ? `${first.code}: ${first.message}` : 'Invalid configuration');
        process.exitCode = 1;
        return;
      }
      const { startServer } = await import('@featuremap/server');
      const { port } = await startServer({ repoRoot });
      console.log(`FeatureMap API listening on http://127.0.0.1:${port}/api`);
      console.log('Press Ctrl+C to stop.');
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

program
  .command('impact')
  .description('Analyze current changes relative to the configured base branch.')
  .action(() => {
    console.error('impact: not implemented yet (Milestone 4 — Change Impact).');
    process.exitCode = 1;
  });

program
  .command('feature')
  .description('Print feature context in terminal-friendly form.')
  .argument('<name-or-id>')
  .action(async (nameOrId: string) => {
    try {
      const { getFeatureContext } = await import('@featuremap/pipeline');
      const context = getFeatureContext(process.cwd(), nameOrId);
      if (!context) {
        console.error(`Feature "${nameOrId}" not found. Run "featuremap scan" first.`);
        process.exitCode = 1;
        return;
      }
      const { feature, assets, documents, evidence } = context;
      console.log(`${feature.name}  [${feature.pattern}]  confidence=${feature.confidence}`);
      console.log('');
      console.log('Health (explainable, derived from evidence):');
      for (const [dim, state] of Object.entries(feature.health)) {
        console.log(`  ${dim.padEnd(20)} ${state}`);
      }
      console.log('');
      console.log('Assets:');
      for (const asset of assets) {
        console.log(`  [${asset.type}] ${asset.label} (${asset.confidence})`);
      }
      if (documents.length > 0) {
        console.log('');
        console.log('Documents:');
        for (const doc of documents) console.log(`  ${doc}`);
      }
      console.log('');
      console.log('Why? (evidence chain):');
      for (const ev of evidence.slice(0, 20)) {
        console.log(`  ${ev.sourceId} → ${feature.name} (${ev.confidence}, ${ev.analyzerId})`);
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

program
  .command('doctor')
  .description('Report detected technologies, config errors, Git status and LLM configuration.')
  .action(async () => {
    const repoRoot = process.cwd();
    console.log('FeatureMap doctor');
    console.log('');

    console.log(`Repository: ${basename(resolve(repoRoot))}`);

    // Configuration
    const configPath = join(repoRoot, CONFIG_FILE_NAME);
    if (existsSync(configPath)) {
      const result = loadConfig(repoRoot);
      if (result.config) {
        console.log(`Config: ${CONFIG_FILE_NAME} OK`);
        console.log(`Analyzers enabled: ${result.config.analyzers.enabled.join(', ')}`);
        console.log(`LLM: ${result.config.llm.enabled ? `enabled (${result.config.llm.provider}; credentials must come from environment variables)` : 'disabled'}`);
        console.log(`Impact minimum confidence: ${result.config.impact.minimumConfidence}`);
      } else {
        console.log('Config: invalid');
      }
      printIssues(result.issues);
    } else {
      console.log(`Config: missing (${CONFIG_FILE_NAME} not found; run "featuremap init")`);
    }

    // Runtime directory
    console.log(
      `Runtime dir: ${existsSync(join(repoRoot, RUNTIME_DIR_NAME)) ? 'present' : 'missing'}`,
    );

    // Git availability and status
    try {
      await $`git --version`;
      const { stdout: branch } = await $`git branch --show-current`;
      console.log(`Git: available (current branch: ${branch.trim() || 'detached'})`);
    } catch {
      console.warn('Git: unavailable — Git analyzers will be degraded (AGENTS.md §3.5).');
    }

    // Security note from SECURITY.md
    try {
      const raw = readFileSync(configPath, 'utf8');
      if (raw.length > 0 && !raw.includes('.env')) {
        console.warn('Warning: scan.ignore should include .env rules (SECURITY.md).');
      }
    } catch {
      // Config missing already reported above.
    }
  });

program.parseAsync(process.argv);
