/**
 * @featuremap/context — the AI Context Layer (Phase 5).
 *
 * Public API for every consumer (CLI, MCP, VS Code, GitHub, HTTP):
 *
 *   buildFeatureContext(repoRoot, featureNameOrId, options)
 *
 * The model is a read-only projection of the Feature Knowledge Graph —
 * this package never writes graph rows. Renderers are pure functions of
 * the model, so machine consumers (MCP/JSON) and humans (markdown /
 * agent) share one deterministic pipeline.
 */
export * from './types.js';
export * from './tokens.js';
export * from './context-resolver.js';
export * from './context-ranker.js';
export * from './context-budget.js';
export * from './context-builder.js';
export * from './context-renderer.js';
export * from './context-document.js';