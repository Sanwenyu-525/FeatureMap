/**
 * FeatureMapClient — JSON-RPC 2.0 client for the FeatureMap IDE service
 * (Phase 6 / ADR-0008 §3).
 *
 * The extension is a pure adapter: it spawns `featuremap ide` as a
 * child process, speaks newline-delimited JSON-RPC over stdio, and
 * owns the process lifecycle. No analysis logic lives here. The
 * transport is injectable so the protocol is unit-testable without
 * spawning a real subprocess.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

/** Wire-contract DTOs (extension-side view; keeps the adapter decoupled). */
export interface IdeProjectStatus {
  initialized: boolean;
  scanned: boolean;
  root: string;
  name?: string;
  baseBranch?: string;
  lastScanAt?: string;
  technologies: Array<{ id: string; confidence: number }>;
  featureCount: number;
}

export interface IdeFeature {
  id: string;
  name: string;
  description?: string;
  pattern: string;
  confidence: number;
  status: string;
  health?: Record<string, string>;
}

export interface IdeAsset {
  id: string;
  type: string;
  path?: string;
  name?: string;
  confidence: number;
  /** Symbol assets resolve to a source location (Feature → Symbol → source). */
  location?: { startLine: number; endLine: number };
}

export interface IdeFeatureDetail extends IdeFeature {
  assets: IdeAsset[];
  documents: Array<{ path: string; title?: string }>;
  candidates: unknown[];
}

/** Code Intelligence DTOs (v0.6.2). Line numbers are 1-based on the wire. */
export interface IdeSymbolRef {
  filePath: string;
  name?: string;
  startLine?: number;
  endLine?: number;
}

export interface IdeResolvedSymbol {
  id: string;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface IdeRelatedFeature {
  featureId: string;
  name: string;
  description?: string;
  pattern: string;
  relation: { type: 'OWNS' | 'DEPENDS_ON'; status: 'confirmed' | 'declared' | 'accepted' | 'suggested'; confidence: number };
  evidence: { available: boolean; count: number };
}

export interface IdeRelatedFeaturesResult {
  symbol: IdeResolvedSymbol;
  features: IdeRelatedFeature[];
}

export interface IdeCodeIntelligence {
  symbol: { id: string; name: string; filePath: string };
  primaryFeature?: { id: string; name: string; relation: 'OWNS' | 'DEPENDS_ON'; confidence: number };
  relatedFeatures: Array<{ id: string; name: string; relation: 'OWNS' | 'DEPENDS_ON'; confidence: number }>;
  directDependencies: Array<{ symbolId?: string; name: string; filePath?: string }>;
  tests: Array<{ path: string; symbolName?: string }>;
  recentChange?: { commit?: string; date?: string; summary?: string };
}

export interface IdeDocumentSymbolFeature {
  symbol: { id: string; name: string; startLine: number; endLine: number };
  feature: { id: string; name: string };
  relation: 'OWNS' | 'DEPENDS_ON';
  confidence: number;
  status: string;
}

export interface IdeExplainChainStep {
  relationType: string;
  sourceId: string;
  targetId: string;
  confidence: number;
}

export interface IdeExplainRelation {
  featureId: string;
  targetId: string;
  targetType: 'file' | 'symbol';
  relation: 'owns' | 'DEPENDS_ON';
  status: string;
  confidence: number;
  chain: IdeExplainChainStep[];
}

/** Live Change Impact DTOs (v0.6.3). */
export interface IdeCurrentAffectedFeature {
  featureId: string;
  name: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  reasons: string[];
  tests: string[];
  documents: string[];
}

export interface IdeCurrentImpactSnapshot {
  repoRoot: string;
  generation: number;
  refreshedAt: string;
  trigger: { type: 'save' | 'manual' | 'scan'; savedFiles: string[] };
  summary: {
    affectedFeatureCount: number;
    bySeverity: Record<'HIGH' | 'MEDIUM' | 'LOW', number>;
    recommendedTestCount: number;
    hasSharedInfrastructureImpact: boolean;
    suppressedUncertaintyCount: number;
  };
  changedFiles: Array<{ path: string; changeType: string }>;
  affectedFeatures: IdeCurrentAffectedFeature[];
  sharedInfrastructure: unknown[];
  recommendedTests: unknown[];
  suppressedUncertainty: unknown[];
  potentiallyStaleDocuments: unknown[];
}

export interface IdeImpactCurrent {
  available: boolean;
  snapshot?: IdeCurrentImpactSnapshot;
}

export interface IdeImpactRefreshResult {
  snapshot: IdeCurrentImpactSnapshot;
  refresh: { scannedFiles: number; changedFiles: number; durationMs: number };
}

/** Review & Diagnostics DTOs (v0.6.4). */
export interface IdeSuggestedRelation {
  feature: { id: string; name: string };
  target: { type: 'file' | 'symbol'; id: string; label: string; location?: { filePath: string; startLine: number; endLine?: number } };
  relation: 'OWNS' | 'DEPENDS_ON';
  status: 'suggested';
  score: number;
  distance: number;
  fanIn: number;
  fingerprint: string;
  evidence: { available: boolean; count: number };
}

export type IdeDriftKind = 'relation_broken' | 'new_candidate';

export interface IdeDriftIssue {
  id: string;
  kind: IdeDriftKind;
  featureId: string;
  featureName?: string;
  targetId: string;
  targetType: 'file' | 'symbol';
  reason: string;
  location?: { filePath: string; startLine: number; endLine?: number };
  candidate?: { fingerprint?: string; status?: string; score?: number };
}

export interface IdeDriftReport {
  issues: IdeDriftIssue[];
  summary: { issueCount: number; byType: Record<IdeDriftKind, number> };
}

export type IdeReviewVerdictResult =
  | { applied: true; candidate: { featureId: string; target: { type: string; id: string }; status: 'accepted' | 'rejected'; fingerprint: string } }
  | { applied: false; reason: 'candidate_changed'; currentCandidate?: IdeSuggestedRelation };

export interface IdeReviewExplain {
  feature: { id: string; name: string };
  target: { type: 'file' | 'symbol'; id: string; label: string };
  relation: 'OWNS' | 'DEPENDS_ON';
  score: number;
  status: string;
  evidenceChain: Array<{ relationType: string; sourceId: string; targetId: string; confidence: number }>;
}

export interface ClientTransport {
  stdin: Writable;
  stdout: Readable;
  dispose(): void;
  onExit(callback: (code: number | null) => void): void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class FeatureMapClient {
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  private disposed = false;

  constructor(public readonly transport: ClientTransport) {
    const reader = createInterface({ input: transport.stdout, crlfDelay: Infinity });
    reader.on('line', (line) => this.handleLine(line));
  }

  request<T>(method: string, params?: unknown): Promise<T> {
    if (this.disposed) {
      return Promise.reject(new Error('FeatureMap service is closed.'));
    }
    const id = ++this.seq;
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject });
      this.transport.stdin.write(message + '\n', 'utf8');
    });
  }

  onExit(callback: (code: number | null) => void): void {
    this.transport.onExit(callback);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const { reject } of this.pending.values()) {
      reject(new Error('FeatureMap service is closed.'));
    }
    this.pending.clear();
    this.transport.dispose();
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (trimmed === '') return;
    let message: { id?: unknown; result?: unknown; error?: { code?: number; message?: string } };
    try {
      message = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (typeof message.id !== 'number') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) {
      const err = new Error(message.error.message ?? 'FeatureMap request failed.') as Error & { code?: number };
      err.code = message.error.code;
      pending.reject(err);
    } else {
      pending.resolve(message.result);
    }
  }
}

/** Resolve the built `featuremap` CLI entry within this workspace. */
export function resolveCliEntry(): string {
  const require_ = createRequire(__filename);
  const pkgPath = require_.resolve('@featuremap/cli/package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin?: Record<string, string> | string };
  const bin =
    pkg.bin && typeof pkg.bin === 'object' && pkg.bin['featuremap'] ? pkg.bin['featuremap'] : 'dist/index.js';
  return join(dirname(pkgPath), bin);
}

export interface SpawnOptions {
  repoRoot: string;
  /** Override the resolved CLI entry (tests use a temp repo + built CLI). */
  cliEntry?: string;
}

/** Spawn `featuremap ide` for a repository and return a connected client. */
export function spawnFeatureMapService(options: SpawnOptions): FeatureMapClient {
  const cliEntry = options.cliEntry ?? resolveCliEntry();
  const child: ChildProcess = spawn(process.execPath, [cliEntry, 'ide'], {
    cwd: options.repoRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (!child.stdin || !child.stdout) {
    throw new Error('FeatureMap service failed to start (no stdio).');
  }
  return new FeatureMapClient({
    stdin: child.stdin,
    stdout: child.stdout,
    dispose: () => child.kill(),
    onExit: (callback) => child.once('exit', callback),
  });
}
