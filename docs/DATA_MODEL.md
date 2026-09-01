# Data Model

## 1. Design goals

The model must support:

- explainability
- incremental updates
- multiple analyzers
- conflicting evidence
- manual corrections
- feature-level queries
- future multi-language support

The source of truth is not a single AI-generated feature mapping. It is an **evidence-backed graph**.

## 2. Core entities

### Feature

```ts
interface Feature {
  id: string;
  name: string;
  description?: string;
  parentId?: string;
  pattern: FeaturePattern;
  confidence: number;
  status: FeatureStatus;
  createdAt: string;
  updatedAt: string;
}
```

### CodeAsset

```ts
interface CodeAsset {
  id: string;
  type:
    | 'file'
    | 'symbol'
    | 'component'
    | 'endpoint'
    | 'data_entity'
    | 'test';
  path?: string;
  name?: string;
  language?: string;
  metadata?: Record<string, unknown>;
}
```

### Document

```ts
interface Document {
  id: string;
  path: string;
  type:
    | 'readme'
    | 'agents'
    | 'claude'
    | 'contributing'
    | 'adr'
    | 'docs'
    | 'config'
    | 'other';
  title?: string;
}
```

### Instruction

```ts
interface Instruction {
  id: string;
  documentId: string;
  text: string;
  scope?: string;
  level: 'required' | 'recommended' | 'informational';
  confidence: number;
}
```

### Evidence

```ts
interface Evidence {
  id: string;
  sourceType: EntityType;
  sourceId: string;
  relationType: RelationType;
  targetType: EntityType;
  targetId: string;
  confidence: number;
  analyzerId: string;
  origin: 'deterministic' | 'semantic' | 'manual';
  metadata?: Record<string, unknown>;
}
```

## 3. Core relation types

Initial relation vocabulary:

```text
IMPORTS
CALLS
REFERENCES
ROUTES_TO
HANDLED_BY
READS
WRITES
VERIFIED_BY
DESCRIBED_BY
CONSTRAINED_BY
IMPLEMENTS
DEPENDS_ON
MODIFIED_BY
AFFECTS
BELONGS_TO_FEATURE
```

Avoid creating near-duplicate relation names unless semantics truly differ.

## 4. Confidence

Suggested semantics:

| Confidence | Meaning |
|---|---|
| 1.00 | deterministic fact or explicit manual mapping |
| 0.90–0.99 | very strong inference |
| 0.80–0.89 | strong inference |
| 0.50–0.79 | uncertain but potentially useful |
| <0.50 | retain internally; do not present as confirmed |

Manual corrections should override lower-authority mappings but the original evidence should remain available for debugging/history.

## 5. Feature health

Feature health should be derived from evidence rather than stored as a free-form AI judgment.

```ts
interface FeatureHealth {
  implementation: HealthState;
  api: HealthState | 'not_applicable';
  tests: HealthState;
  documentation: HealthState;
  instructions: HealthState | 'not_applicable';
  documentationDrift: 'clear' | 'warning' | 'unknown';
}
```

## 6. SQLite MVP tables

Suggested tables:

```text
projects
scans
files
symbols
assets
documents
instructions
evidence
features
feature_assets
feature_documents
feature_instructions
commits
commit_files
analyzer_runs
manual_overrides
```

A generic `evidence` table is important even if convenience join tables are later added.

## 7. Manual overrides

Users must eventually be able to confirm or correct mappings.

```ts
interface ManualOverride {
  id: string;
  action: 'add_relation' | 'remove_relation' | 'rename_feature' | 'merge_feature';
  payload: Record<string, unknown>;
  createdAt: string;
}
```

Do not destroy analyzer evidence when an override exists.

## 8. Context package

MCP and CLI should consume a bounded derived model:

```ts
interface FeatureContext {
  feature: Feature;
  flow: FlowNode[];
  assets: CodeAsset[];
  tests: CodeAsset[];
  documents: DocumentReference[];
  instructions: Instruction[];
  recentChanges: GitChange[];
  evidenceSummary: EvidenceSummary[];
}
```

This object is a consumer model, not the primary storage model.

