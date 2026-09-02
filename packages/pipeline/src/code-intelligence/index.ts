/**
 * Code Intelligence (Phase 6 / v0.6.2).
 *
 * Projects the Feature Knowledge Graph onto editor code positions:
 * Symbol→Related Features, Hover payloads, document CodeLens and
 * explainable relations. `SymbolFeatureIndex` is an in-memory read
 * model; the pipeline remains the single source of truth.
 */
export * from './types.js';
export * from './policy.js';
export * from './symbol-feature-index.js';
export * from './intelligence.js';
export * from './explain.js';
