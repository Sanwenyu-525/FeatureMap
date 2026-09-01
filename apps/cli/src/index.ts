/**
 * FeatureMap CLI (docs/MVP_SPEC.md §6).
 *
 * Milestone 0 scope: `init` and `doctor` are functional; `scan`,
 * `feature`, `impact` and `dev` were implemented in Milestones 1–5
 * (docs/DEVELOPMENT_PLAN.md). Output is localized to Chinese.
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
  .description('本地优先的代码库智能层：按产品功能组织代码、测试、API、文档与 Git 变更。')
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
  .description('创建 featuremap.yaml 与 .featuremap 运行时目录。')
  .action(() => {
    const repoRoot = process.cwd();
    const configPath = join(repoRoot, CONFIG_FILE_NAME);
    if (existsSync(configPath)) {
      console.log(`${CONFIG_FILE_NAME} 已存在，保持不变。`);
      return;
    }
    const config = defaultConfig(basename(resolve(repoRoot)));
    writeFileSync(configPath, stringifyYaml(config), 'utf8');
    mkdirSync(join(repoRoot, RUNTIME_DIR_NAME), { recursive: true });
    console.log(`已创建 ${CONFIG_FILE_NAME}`);
    console.log(`已创建 ${RUNTIME_DIR_NAME}/`);
  });

program
  .command('scan')
  .description('扫描仓库并更新本地证据索引。')
  .option('--json', '输出机器可读的 JSON')
  .option('--full', '强制全量重扫')
  .option('--no-llm', '本次扫描禁用语义分析')
  .action(async (opts: { json?: boolean; full?: boolean }) => {
    try {
      const repoRoot = process.cwd();
      const result = await runScan(repoRoot, { json: opts.json, full: opts.full });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`项目：${result.project.name}`);
        console.log(`分支：${result.project.currentBranch ?? '未知'}`);
        console.log('');
        console.log('技术栈');
        for (const t of result.technologies) console.log(`✓ ${t.id}`);
        console.log('');
        console.log(`文件：${result.counts.files}`);
        console.log(`符号：${result.counts.symbols}`);
        console.log(`端点：${result.counts.endpoints}`);
        console.log(`文档：${result.counts.documents}`);
        console.log(`功能：${result.counts.features}`);
        console.log(`证据：${result.counts.evidence}`);
        console.log(`提交：${result.counts.commits}`);
        console.log('');
        console.log('分析器');
        for (const run of result.runs) console.log(`✓ ${run.analyzerId}: ${run.status}`);
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

program
  .command('dev')
  .description('启动本地 API 与 Web UI。')
  .action(async () => {
    try {
      const repoRoot = process.cwd();
      const loaded = loadConfig(repoRoot);
      if (!loaded.config) {
        const first = loaded.issues.find((i) => i.level === 'error') ?? loaded.issues[0];
        console.error(first ? `${first.code}: ${first.message}` : '配置无效');
        process.exitCode = 1;
        return;
      }
      const { startServer } = await import('@featuremap/server');
      const { port } = await startServer({ repoRoot });
      console.log(`FeatureMap 界面：  http://127.0.0.1:${port}`);
      console.log(`FeatureMap API：http://127.0.0.1:${port}/api`);
      console.log('按 Ctrl+C 停止。');
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

program
  .command('impact')
  .description('基于证据遍历，分析当前变更影响哪些功能。')
  .action(async () => {
    try {
      const { analyzeImpact } = await import('@featuremap/pipeline');
      const result = analyzeImpact(process.cwd());
      console.log(`分支：${result.currentBranch ?? '未知'}（基准：${result.baseBranch ?? '未知'}）`);
      console.log('');
      console.log(`变更文件（${result.changedFiles.length}）：`);
      for (const f of result.changedFiles) {
        console.log(`  [${f.changeType.toUpperCase()}] ${f.path}`);
      }
      if (result.changedFiles.length === 0) {
        console.log('  （未检测到未提交或分支变更）');
      }
      console.log('');
      console.log(`受影响功能（${result.affectedFeatures.length}）：`);
      for (const f of result.affectedFeatures) {
        console.log(`  ${f.featureName}（${f.featureId}）—— 置信度 ${f.confidence}`);
        for (const reason of f.reasons) console.log(`    · ${reason}`);
        if (f.tests.length > 0) console.log(`    相关测试：${f.tests.join(', ')}`);
        if (f.documents.length > 0) console.log(`    相关文档：${f.documents.join(', ')}`);
      }
      if (result.affectedFeatures.length === 0) {
        console.log('  （没有达到可展示置信度的影响）');
      }
      if (result.potentiallyStaleDocuments.length > 0) {
        console.log('');
        console.log('可能过期的文档：');
        for (const d of result.potentiallyStaleDocuments) {
          console.log(`  ${d.path} —— ${d.reason}`);
        }
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

program
  .command('feature')
  .description('以终端友好的形式输出功能上下文。')
  .argument('<name-or-id>', '功能名称或 ID')
  .action(async (nameOrId: string) => {
    try {
      const { getFeatureContext } = await import('@featuremap/pipeline');
      const context = getFeatureContext(process.cwd(), nameOrId);
      if (!context) {
        console.error(`未找到功能"${nameOrId}"。请先运行 "featuremap scan"。`);
        process.exitCode = 1;
        return;
      }
      const { feature, assets, documents, evidence } = context;
      console.log(`${feature.name}  [${feature.pattern}]  置信度=${feature.confidence}`);
      console.log('');
      console.log('健康状态（可解释，来源于证据）：');
      for (const [dim, state] of Object.entries(feature.health)) {
        console.log(`  ${dim.padEnd(20)} ${state}`);
      }
      console.log('');
      console.log('资产：');
      for (const asset of assets) {
        console.log(`  [${asset.type}] ${asset.label} (${asset.confidence})`);
      }
      if (documents.length > 0) {
        console.log('');
        console.log('文档：');
        for (const doc of documents) console.log(`  ${doc}`);
      }
      console.log('');
      console.log('为什么？（证据链）：');
      for (const ev of evidence.slice(0, 20)) {
        console.log(`  ${ev.sourceId} → ${feature.name} (${ev.confidence}, ${ev.analyzerId})`);
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

program
  .command('mcp')
  .description('以 stdio 方式运行 FeatureMap MCP 服务器。')
  .action(async () => {
    try {
      const { startMcpStdio } = await import('@featuremap/mcp');
      await startMcpStdio({ repoRoot: process.cwd() });
      // stdio transport keeps the process alive; Ctrl+C terminates.
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

program
  .command('doctor')
  .description('报告检测到的技术栈、配置错误、Git 状态与 LLM 配置。')
  .action(async () => {
    const repoRoot = process.cwd();
    console.log('FeatureMap 诊断');
    console.log('');

    console.log(`仓库：${basename(resolve(repoRoot))}`);

    // Configuration
    const configPath = join(repoRoot, CONFIG_FILE_NAME);
    if (existsSync(configPath)) {
      const result = loadConfig(repoRoot);
      if (result.config) {
        console.log(`配置：${CONFIG_FILE_NAME} 正常`);
        console.log(`已启用分析器：${result.config.analyzers.enabled.join(', ')}`);
        console.log(
          `LLM：${result.config.llm.enabled ? `已启用（${result.config.llm.provider}；凭据必须来自环境变量）` : '未启用'}`,
        );
        console.log(`影响遍历最低置信度：${result.config.impact.minimumConfidence}`);
      } else {
        console.log('配置：无效');
      }
      printIssues(result.issues);
    } else {
      console.log(`配置：缺失（未找到 ${CONFIG_FILE_NAME}；请先运行 "featuremap init"）`);
    }

    // Runtime directory
    console.log(
      `运行时目录：${existsSync(join(repoRoot, RUNTIME_DIR_NAME)) ? '存在' : '缺失'}`,
    );

    // Git availability and status
    try {
      await $`git --version`;
      const { stdout: branch } = await $`git branch --show-current`;
      console.log(`Git：可用（当前分支：${branch.trim() || 'detached'}）`);
    } catch {
      console.warn('Git：不可用——Git 分析器将降级运行（AGENTS.md §3.5）。');
    }

    // Security note from SECURITY.md
    try {
      const raw = readFileSync(configPath, 'utf8');
      if (raw.length > 0 && !raw.includes('.env')) {
        console.warn('警告：scan.ignore 应包含 .env 规则（SECURITY.md）。');
      }
    } catch {
      // Config missing already reported above.
    }
  });

program.parseAsync(process.argv);
