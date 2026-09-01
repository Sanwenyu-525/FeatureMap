/**
 * Core entity types defined in docs/DATA_MODEL.md §2.
 */

/**
 * Semantic pattern of a feature (docs/MVP_SPEC.md §8).
 * `Generic` is used when pattern confidence is insufficient.
 */
export type FeaturePattern =
  | 'Authentication'
  | 'CRUD'
  | 'Workflow'
  | 'Event'
  | 'Pipeline'
  | 'Generic';

export type FeatureStatus = 'active' | 'merged' | 'archived';

export interface Feature {
  id: string;
  name: string;
  description?: string;
  parentId?: string;
  pattern: FeaturePattern;
  /** 0..1; semantics defined in docs/DATA_MODEL.md §4. */
  confidence: number;
  status: FeatureStatus;
  createdAt: string;
  updatedAt: string;
}

export type CodeAssetType =
  | 'file'
  | 'symbol'
  | 'component'
  | 'endpoint'
  | 'data_entity'
  | 'test';

export interface CodeAsset {
  id: string;
  type: CodeAssetType;
  path?: string;
  name?: string;
  language?: string;
  metadata?: Record<string, unknown>;
}

export type DocumentType =
  | 'readme'
  | 'agents'
  | 'claude'
  | 'contributing'
  | 'adr'
  | 'docs'
  | 'config'
  | 'other';

export interface Document {
  id: string;
  path: string;
  type: DocumentType;
  title?: string;
}

export type InstructionLevel = 'required' | 'recommended' | 'informational';

export interface Instruction {
  id: string;
  documentId: string;
  text: string;
  scope?: string;
  level: InstructionLevel;
  confidence: number;
}

/**
 * Entity types allowed as Evidence source/target.
 * Covers code assets plus features, documents, instructions and Git
 * commits (persisted in the `commits` table) so a single normalized
 * Evidence record can connect any two entities.
 */
export type EntityType =
  | 'feature'
  | 'file'
  | 'symbol'
  | 'component'
  | 'endpoint'
  | 'data_entity'
  | 'test'
  | 'document'
  | 'instruction'
  | 'commit';

/** Whether evidence was produced by deterministic analysis, semantic (LLM) inference, or manual correction. */
export type EvidenceOrigin = 'deterministic' | 'semantic' | 'manual';

export interface Evidence {
  id: string;
  sourceType: EntityType;
  sourceId: string;
  relationType: string;
  targetType: EntityType;
  targetId: string;
  /** 0..1; semantics defined in docs/DATA_MODEL.md §4. */
  confidence: number;
  analyzerId: string;
  origin: EvidenceOrigin;
  metadata?: Record<string, unknown>;
}
