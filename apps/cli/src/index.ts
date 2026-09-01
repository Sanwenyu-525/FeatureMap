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
  .description('扫描仓库并更新本地证据索引。可传功能名以查看该功能的候选代码。')
  .argument('[featureId]', '可选：功能名称或 ID（如 login），输出其候选代码')
  .option('--json', '输出机器可读的 JSON')
  .option('--full', '强制全量重扫')
  .option('--no-llm', '本次扫描禁用语义分析')
  .action(async (featureId: string | undefined, opts: { json?: boolean; full?: boolean }) => {
    try {
      const repoRoot = process.cwd();
      const result = await runScan(repoRoot, { json: opts.json, full: opts.full });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
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
      console.log(`候选：${result.counts.candidates}`);
      console.log(`证据：${result.counts.evidence}`);
      console.log(`提交：${result.counts.commits}`);
      console.log('');
      console.log(`增量：变更 ${result.counts.changedFiles}，缓存命中 ${result.counts.cachedFiles}`);
      const tsRun = result.runs.find((r) => r.analyzerId === 'typescript');
      const hits = tsRun?.stats?.['cacheHits'] ?? 0;
      const misses = tsRun?.stats?.['cacheMisses'] ?? 0;
      if (hits > 0 || misses > 0) {
        console.log(`解析：缓存复用 ${hits}，重新解析 ${misses}`);
      }
      console.log('');
      console.log('分析器');
      for (const run of result.runs) console.log(`✓ ${run.analyzerId}: ${run.status}`);

      if (featureId !== undefined) {
        const slug = featureId.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const fid = `feature:${slug}`;
        const feature = result.features.find((f) => f.id === fid);
        if (!feature) {
          console.error(`未知功能：${featureId}（feature:${slug}）。使用 featuremap scan 查看全部功能。`);
          process.exitCode = 1;
          return;
        }
        const candidates = result.candidates
          .filter((c) => c.featureId === fid)
          .sort((a, b) => b.score - a.score);
        console.log('');
        console.log(`功能 ${feature.name}（${fid}）的候选代码：`);
        for (const c of candidates) {
          const percent = `${Math.round(c.score * 100)}%`.padStart(4);
          const relation = c.relation === 'owns' ? 'owns      ' : 'DEPENDS_ON';
          console.log(`${percent}  ${c.status.padEnd(10)} ${relation}  ${c.targetId}`);
        }
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
  .description('基于证据遍历，分析变更影响哪些功能。可传提交区间查看历史变更的影响（ADR-0004）。')
  .argument('[range]', '可选：提交区间（HEAD、HEAD~1..HEAD、main..HEAD）；缺省为工作树 + 分支差异')
  .action(async (range?: string) => {
    try {
      const { analyzeImpact } = await import('@featuremap/pipeline');
      const result = await analyzeImpact(process.cwd(), { range });
      console.log(`分支：${result.currentBranch ?? '未知'}（基准：${result.baseBranch ?? '未知'}）`);
      console.log('');
      console.log(`变更文件（${result.changedFiles.length}）：`);
      for (const f of result.changedFiles) {
        console.log(`  [${f.changeType.toUpperCase()}] ${f.path}`);
      }
      if (result.changedFiles.length === 0) {
        console.log('  （未检测到该区间的变更）');
      }
      console.log('');
      console.log(`受影响功能（${result.affectedFeatures.length}）：`);
      let lastSeverity: string | undefined;
      for (const f of result.affectedFeatures) {
        if (f.severity !== lastSeverity) {
          console.log(`  ${f.severity}`);
          lastSeverity = f.severity;
        }
        console.log(`    ${f.featureName}（${f.featureId}）—— 置信度 ${f.confidence}`);
        for (const reason of f.reasons) console.log(`      · ${reason}`);
        if (f.tests.length > 0) console.log(`      相关测试：${f.tests.join(', ')}`);
        if (f.documents.length > 0) console.log(`      相关文档：${f.documents.join(', ')}`);
      }
      if (result.affectedFeatures.length === 0) {
        console.log('  （没有达到可展示置信度的影响）');
      }
      if (result.sharedInfrastructure.length > 0) {
        console.log('');
        console.log('共享基础设施（不归属任何单一功能）：');
        for (const s of result.sharedInfrastructure) {
          console.log(`  ${s.path} —— ${s.reason}`);
        }
      }
      if (result.suppressedUncertainty.length > 0) {
        console.log('');
        console.log('未达展示阈值的低置信度影响（显式呈现不确定性）：');
        for (const u of result.suppressedUncertainty) {
          console.log(`  ${u.featureName ?? u.featureId} —— 置信度 ${u.confidence}（${u.reason}）`);
        }
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

/** Shared action for `accept` / `reject`. */
function reviewAction(verdict: 'accepted' | 'rejected') {
  return async (featureId: string, target: string) => {
    try {
      const { setVerdict } = await import('@featuremap/pipeline');
      const row = setVerdict(process.cwd(), featureId, target, verdict);
      const label = verdict === 'accepted' ? '已确认' : '已拒绝';
      console.log(`${label}：${row.targetId}（${Math.round(row.score * 100)}%，${row.relation}）`);
      console.log('重扫描将保留此决定；若其证据链变化会标记为 superseded 供重审。');
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  };
}

program
  .command('accept')
  .description('确认一个候选代码属于该功能。')
  .argument('<featureId>', '功能名称或 ID（如 login）')
  .argument('<target>', '候选 ID 或唯一符号名（如 src/auth/auth-service.ts:login）')
  .action(reviewAction('accepted'));

program
  .command('reject')
  .description('拒绝一个候选代码，重扫描后不再作为建议出现。')
  .argument('<featureId>', '功能名称或 ID（如 login）')
  .argument('<target>', '候选 ID 或唯一符号名')
  .action(reviewAction('rejected'));

program
  .command('explain')
  .description('解释系统为什么认为某候选代码属于该功能：完整证据链 + 置信度。')
  .argument('<featureId>', '功能名称或 ID（如 login）')
  .argument('<target>', '候选 ID 或唯一符号名')
  .action(async (featureId: string, target: string) => {
    try {
      const { explainCandidate } = await import('@featuremap/pipeline');
      const result = explainCandidate(process.cwd(), featureId, target);
      console.log(`${result.targetId}  [${result.targetType}]`);
      console.log('');
      console.log(`状态：${result.status}    关系：${result.relation}    置信度：${Math.round(result.score * 100)}%    距离：${result.distance}    fan-in：${result.fanIn}`);
      console.log('');
      console.log('证据链：');
      for (const step of result.chain) {
        console.log(`  ${step.sourceId}`);
        console.log(`    ↓ ${step.relationType} (${step.confidence})`);
      }
      console.log(`  ${result.targetId}`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

program
  .command('inspect')
  .description('查看某个文件的代码图邻域：包含符号、导出、导入、调用、被调用。')
  .argument('<file>', '仓库相对路径（如 src/auth/login.js）')
  .action(async (file: string) => {
    try {
      const { inspectFile } = await import('@featuremap/pipeline');
      const result = inspectFile(process.cwd(), file.replaceAll('\\', '/'));
      console.log(`${result.file}`);
      console.log('');
      console.log(`包含符号（${result.contains.length}）：`);
      for (const c of result.contains) {
        const name = c.symbolId.slice(c.symbolId.lastIndexOf(':') + 1);
        console.log(`  [${c.kind}] ${name}`);
      }
      if (result.exports.length > 0) {
        console.log('');
        console.log(`导出（${result.exports.length}）：`);
        for (const e of result.exports) {
          console.log(`  ${e.slice(e.lastIndexOf(':') + 1)}`);
        }
      }
      console.log('');
      console.log(`导入（${result.imports.length}）：`);
      for (const i of result.imports) console.log(`  → ${i}`);
      if (result.importedBy.length > 0) {
        console.log('');
        console.log(`被导入（${result.importedBy.length}）：`);
        for (const i of result.importedBy) console.log(`  ← ${i}`);
      }
      if (result.calls.length > 0) {
        console.log('');
        console.log(`调用（${result.calls.length}）：`);
        for (const c of result.calls) {
          console.log(`  ${c.sourceId} → ${c.targetId}（${c.confidence}，${c.analyzerId}）`);
        }
      }
      if (result.calledBy.length > 0) {
        console.log('');
        console.log(`被调用（${result.calledBy.length}）：`);
        for (const c of result.calledBy) {
          console.log(`  ← ${c.sourceId}（${c.confidence}，${c.analyzerId}）`);
        }
      }
      if (result.componentUsage.length > 0) {
        console.log('');
        console.log(`组件使用（${result.componentUsage.length}）：`);
        for (const c of result.componentUsage) {
          console.log(`  ${c.sourceId} → ${c.targetId}`);
        }
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

program
  .command('git')
  .description('Git 变更模型子命令（Phase 3，ADR-0004）。')
  .command('inspect')
  .description('查看某提交的变更模型：元信息、变更文件、变更符号（diff hunk 行区间 ∩ 符号区间）。')
  .argument('<commit-ish>', '提交引用（如 HEAD、HEAD~2、完整 SHA）')
  .action(async (commitIsh: string) => {
    try {
      const { inspectCommit } = await import('@featuremap/pipeline');
      const r = await inspectCommit(process.cwd(), commitIsh);
      console.log(`提交：${r.sha}`);
      console.log(`作者：${r.author ?? '未知'} <${r.email ?? ''}>`);
      console.log(`时间：${r.committedAt ?? '未知'}`);
      if (r.message) console.log(`信息：${r.message}`);
      if (r.approximate) {
        console.log('⚠ 该提交不是当前 HEAD：变更符号按最新扫描的行号匹配，可能已漂移（approximate）。');
      }
      console.log('');
      console.log(`变更文件（${r.changedFiles.length}）：`);
      for (const f of r.changedFiles) {
        console.log(`  [${f.changeType.toUpperCase()}] ${f.path}`);
      }
      console.log('');
      console.log(`变更符号（${r.changedSymbols.length}）：`);
      for (const s of r.changedSymbols) {
        const name = s.symbolId.slice(s.symbolId.lastIndexOf(':') + 1);
        console.log(`  ${name}  [${s.kind}] ${s.path}:${s.startLine}-${s.endLine}（行 ${s.lines.join(', ')}）`);
      }
      if (r.changedSymbols.length === 0) {
        console.log('  （该提交的变更行未命中已扫描的符号区间；可能仅改动导入/导出或数据行）');
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
