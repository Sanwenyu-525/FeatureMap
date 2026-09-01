/**
 * Deterministic feature discovery — Milestone 2 (docs/DEVELOPMENT_PLAN.md),
 * docs/MVP_SPEC.md §8, docs/DATA_MODEL.md §5.
 *
 * Local-first baseline: features are clustered from deterministic
 * evidence only (AGENTS.md §3.2). LLMs may later refine naming and
 * grouping, but never replace the evidence path.
 *
 * Algorithm:
 *  1. Endpoints anchor candidate features; the route's last segment is
 *     the resource, and endpoints sharing a resource merge into one
 *     feature.
 *  2. The feature's implementation closure follows IMPORTS edges from
 *     the endpoint file and handler files (deterministic graph walk).
 *  3. Health is derived per docs/MVP_SPEC.md §9 — explainable states,
 *     never opaque percentages.
 *  4. Every mapping emits BELONGS_TO_FEATURE evidence with an analyzer
 *     identity and confidence, so the UI can always answer "Why?".
 */
import type { FeatureHealth, FeaturePattern } from '@featuremap/core';
import type { PlatformAsset, PlatformEvidence } from '@featuremap/analyzer';
import { openDatabase, defaultDatabasePath, schema } from '@featuremap/db';
import { eq, or, sql } from 'drizzle-orm';

export interface FeatureContextRow {
  feature: {
    id: string;
    name: string;
    pattern: string;
    confidence: number;
    health: Record<string, string>;
  };
  assets: Array<{ type: string; label: string; confidence: number }>;
  documents: string[];
  evidence: Array<{ sourceId: string; confidence: number; analyzerId: string }>;
}

/**
 * Terminal-friendly feature context for `featuremap feature <name>`.
 * Returns undefined when the feature is unknown.
 */
export function getFeatureContext(repoRoot: string, nameOrId: string): FeatureContextRow | undefined {
  const { db, sqlite } = openDatabase(defaultDatabasePath(repoRoot));
  try {
    const slug = nameOrId.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const row = db
      .select()
      .from(schema.features)
      .where(
        or(
          eq(schema.features.id, `feature:${slug}`),
          sql`lower(${schema.features.name}) = lower(${nameOrId})`,
        ),
      )
      .all()[0];
    if (!row) return undefined;

    const assets = db
      .select()
      .from(schema.featureAssets)
      .where(eq(schema.featureAssets.featureId, row.id))
      .all()
      .flatMap((fa) => {
        const asset = db
          .select()
          .from(schema.assets)
          .where(eq(schema.assets.id, fa.assetId))
          .all()[0];
        if (!asset) return [];
        return [
          {
            type: asset.type,
            label: asset.path ?? asset.name ?? asset.id,
            confidence: fa.confidence,
          },
        ];
      });

    const documents = db
      .select()
      .from(schema.featureDocuments)
      .where(eq(schema.featureDocuments.featureId, row.id))
      .all()
      .map((fd) => fd.documentId);

    const evidence = db
      .select()
      .from(schema.evidence)
      .where(
        sql`${schema.evidence.targetType} = 'feature' and ${schema.evidence.targetId} = ${row.id}`,
      )
      .all()
      .map((e) => ({ sourceId: e.sourceId, confidence: e.confidence, analyzerId: e.analyzerId }));

    return {
      feature: {
        id: row.id,
        name: row.name,
        pattern: row.pattern,
        confidence: row.confidence,
        health: (row.health ?? {}) as Record<string, string>,
      },
      assets,
      documents,
      evidence,
    };
  } finally {
    sqlite.close();
  }
}

export interface DiscoveredFeature {
  id: string;
  name: string;
  pattern: FeaturePattern;
  confidence: number;
  health: FeatureHealth;
  /** Direct endpoint assets and handler symbols (confidence 1.0). */
  anchors: PlatformAsset[];
  /** Closure files (confidence 0.9): feature_assets + evidence. */
  closureFiles: string[];
  documents: string[];
  tests: string[];
}

const AUTH_KEYWORDS = /auth|login|logout|register|signup|session|token|password|oauth/i;
const TEST_FILE_PATTERN = /\.(test|spec)\.[jt]sx?$|__tests__|\/tests?\//i;

export function isTestPath(path: string): boolean {
  return TEST_FILE_PATTERN.test(path);
}

interface EndpointInfo {
  asset: PlatformAsset;
  method: string;
  routePath: string;
  resource: string;
  file: string;
  handlerFile?: string;
}

/** Extract the resource segment from a route path (e.g. /api/login → login). */
export function resourceOf(routePath: string): string {
  const segments = routePath
    .split('/')
    .filter((s) => s !== '' && !/^[{*{]/.test(s) && !s.startsWith(':'));
  const last = segments[segments.length - 1] ?? 'root';
  return last.toLowerCase();
}

export function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'feature';
}

export function discoverFeatures(
  assets: PlatformAsset[],
  evidence: PlatformEvidence[],
): DiscoveredFeature[] {
  // ---- Index deterministic evidence ------------------------------------
  const endpoints = new Map<string, EndpointInfo>();
  const imports = new Map<string, Set<string>>();
  const describedBy = new Map<string, Set<string>>();
  const handlerOfEndpoint = new Map<string, string>();

  for (const asset of assets) {
    if (asset.type !== 'endpoint' || asset.name === undefined) continue;
    const meta = (asset.metadata ?? {}) as { method?: string; routePath?: string };
    const method = meta.method ?? asset.name.split(' ')[0] ?? 'GET';
    const routePath = meta.routePath ?? asset.name.split(' ').slice(1).join(' ');
    endpoints.set(`endpoint:${asset.name}`, {
      asset,
      method,
      routePath,
      resource: resourceOf(routePath),
      file: asset.path ?? '',
    });
  }

  for (const ev of evidence) {
    if (ev.analyzerId === 'feature-engine') continue;
    if (ev.relationType === 'IMPORTS' && ev.sourceType === 'file' && ev.targetType === 'file') {
      if (!imports.has(ev.sourceId)) imports.set(ev.sourceId, new Set());
      imports.get(ev.sourceId)!.add(ev.targetId);
    }
    if (
      ev.relationType === 'HANDLED_BY' &&
      ev.sourceType === 'endpoint' &&
      ev.targetType === 'symbol'
    ) {
      handlerOfEndpoint.set(ev.sourceId, ev.targetId);
    }
    if (
      ev.relationType === 'DESCRIBED_BY' &&
      ev.sourceType === 'file' &&
      ev.targetType === 'document'
    ) {
      if (!describedBy.has(ev.sourceId)) describedBy.set(ev.sourceId, new Set());
      describedBy.get(ev.sourceId)!.add(ev.targetId);
    }
  }

  // symbolId format: symbol:<file>:<name> — the file is everything
  // between the first and last colon.
  const fileOfSymbol = (symbolId: string): string | undefined => {
    const rest = symbolId.slice('symbol:'.length);
    const idx = rest.lastIndexOf(':');
    return idx === -1 ? undefined : rest.slice(0, idx);
  };

  // ---- Cluster endpoints by resource ------------------------------------
  const byResource = new Map<string, EndpointInfo[]>();
  for (const [id, info] of endpoints) {
    if (!byResource.has(info.resource)) byResource.set(info.resource, []);
    byResource.get(info.resource)!.push(info);
    void id;
  }

  // Hub files (e.g. a central app.js registering many different
  // resources) would otherwise pull every other feature's files into
  // the closure. Their IMPORTS edges are therefore not expanded; the
  // endpoints themselves remain anchors with ROUTES_TO evidence.
  const endpointsPerFile = new Map<string, Set<string>>();
  for (const info of endpoints.values()) {
    if (!endpointsPerFile.has(info.file)) endpointsPerFile.set(info.file, new Set());
    endpointsPerFile.get(info.file)!.add(info.resource);
  }
  const hubFiles = new Set(
    [...endpointsPerFile.entries()].filter(([, resources]) => resources.size >= 2).map(([f]) => f),
  );

  // Tests: files the test imports map to the implementing files.
  const testFiles = assets
    .filter((a) => (a.type === 'test' || a.type === 'file') && a.path && isTestPath(a.path))
    .map((a) => a.path!);

  const features: DiscoveredFeature[] = [];

  for (const [resource, infos] of byResource) {
    const slug = slugify(resource);
    const featureId = `feature:${slug}`;
    const name = capitalize(resource);

    const handlerFiles = infos
      .map((i) => (handlerOfEndpoint.has(`endpoint:${i.asset.name}`) ? fileOfSymbol(handlerOfEndpoint.get(`endpoint:${i.asset.name}`)!) : undefined))
      .filter((f): f is string => f !== undefined);

    const seedFiles = [...new Set([...infos.map((i) => i.file), ...handlerFiles])].filter(Boolean);
    const closure = closureOf(seedFiles, imports, hubFiles);

    const withHandler = infos.filter((i) => handlerOfEndpoint.has(`endpoint:${i.asset.name}`));
    const allHaveHandler = withHandler.length === infos.length;

    // Pattern classification: deterministic keyword / shape rules.
    let pattern: FeaturePattern = 'Generic';
    if (infos.some((i) => AUTH_KEYWORDS.test(i.routePath))) {
      pattern = 'Authentication';
    } else if (hasCrudShape(infos)) {
      pattern = 'CRUD';
    }

    const tests = testFiles.filter((t) =>
      (imports.get(t) ?? new Set()).size > 0
        ? [...(imports.get(t) ?? new Set())].some((f) => closure.has(f))
        : false,
    );

    const documents = new Set<string>();
    for (const file of closure) {
      for (const doc of describedBy.get(file) ?? []) documents.add(doc);
    }

    const health: FeatureHealth = {
      implementation: allHaveHandler ? 'complete' : withHandler.length > 0 ? 'partial' : 'unknown',
      api: 'complete',
      tests: tests.length > 0 ? 'present' : 'missing',
      documentation: documents.size > 0 ? 'present' : 'missing',
      instructions: 'not_applicable',
      documentationDrift: documents.size > 0 ? 'clear' : 'unknown',
    };

    features.push({
      id: featureId,
      name,
      pattern,
      // Very strong inference when every endpoint is handled by a
      // known symbol; strong when only the route file is known.
      confidence: allHaveHandler ? 0.9 : 0.8,
      health,
      anchors: infos.map((i) => i.asset),
      closureFiles: [...closure].filter((f) => !f.endsWith('.md')),
      documents: [...documents],
      tests,
    });
  }

  return features.sort((a, b) => a.id.localeCompare(b.id));
}

function hasCrudShape(infos: EndpointInfo[]): boolean {
  const methods = new Set(infos.map((i) => i.method.toUpperCase()));
  const hasRead = methods.has('GET');
  const hasWrite = [...methods].some((m) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(m));
  return hasRead && hasWrite;
}

/** BFS over IMPORTS edges from the seed files; hub files are not expanded. */
function closureOf(
  seeds: string[],
  imports: Map<string, Set<string>>,
  blocked: Set<string>,
): Set<string> {
  const seen = new Set<string>();
  const queue = [...seeds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current) || current === '') continue;
    seen.add(current);
    if (blocked.has(current)) continue;
    for (const next of imports.get(current) ?? []) {
      if (!seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

function capitalize(input: string): string {
  return input.charAt(0).toUpperCase() + input.slice(1);
}
