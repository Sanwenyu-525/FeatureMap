/**
 * Live Change Impact (v0.6.3).
 *
 * Turns the existing change-impact analysis into a save-triggered IDE
 * workflow: incremental graph refresh → analyzeImpact(WORKING_TREE) →
 * a generation-guarded CurrentImpactSnapshot the extension reads
 * cheaply. savedFiles is a scan hint; WORKING_TREE is the impact scope.
 */
export * from './live-impact-types.js';
export * from './current-impact-store.js';
export * from './refresh-current-impact.js';
