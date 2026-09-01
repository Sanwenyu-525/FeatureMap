/**
 * @featuremap/core — domain types and algorithms.
 *
 * This package must stay framework-agnostic (AGENTS.md §3.3):
 * no React, Fastify, Drizzle, framework analyzers, or provider-specific
 * LLM SDKs may be imported here.
 */

export * from './types/entities.js';
export * from './types/relations.js';
export * from './types/health.js';
export * from './types/anchors.js';
export * from './confidence.js';
export * from './paths.js';
export * from './config.js';
