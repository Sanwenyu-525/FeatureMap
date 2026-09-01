# Architecture

## 1. System overview

```text
                         Repository
                             │
       ┌─────────────────────┼──────────────────────┐
       ▼                     ▼                      ▼
   Source Code              Git                  Documents
       │                     │                      │
       ▼                     ▼                      ▼
 Language / Framework     Git Analyzer       Document Analyzer
       Analyzers              │                      │
       └──────────────────────┼──────────────────────┘
                              ▼
                           Evidence
                              │
                              ▼
                       Evidence Store
                         (SQLite)
                              │
                              ▼
                       Feature Engine
                    ┌─────────┴─────────┐
                    ▼                   ▼
            Deterministic graph    Semantic / LLM
                    └─────────┬─────────┘
                              ▼
                         Feature Graph
                              │
             ┌────────────────┼────────────────┐
             ▼                ▼                ▼
            CLI              Web              MCP
```

## 2. Major components

### 2.1 Scanner

Responsibilities:

- repository discovery
- ignore rules
- file hashing
- changed-file detection
- technology detection
- document discovery

The scanner does not understand framework semantics.

### 2.2 Analyzer platform

Responsibilities:

- execute analyzer plugins
- provide file/content access
- normalize analyzer output
- isolate analyzer failures
- attach analyzer identity and confidence

### 2.3 Evidence store

SQLite-backed local store containing:

- assets
- evidence
- relations
- feature assignments
- documents
- instructions
- Git metadata
- scan/cache metadata

### 2.4 Feature engine

Responsibilities:

- cluster evidence into candidate features
- merge deterministic and semantic evidence
- apply manual overrides
- compute feature health
- generate explainable feature context

### 2.5 Local server

Fastify server exposing local APIs for Web and optional integrations.

### 2.6 Web UI

React/Vite single-page application.

The Web UI consumes feature-oriented APIs and must not implement repository analysis itself.

### 2.7 MCP server

Provides bounded feature context for coding agents.

### 2.8 Context builder (Phase 5)

`packages/context` computes a **read-only projection** of the Feature
Knowledge Graph: a ranked, budget-aware, evidence-backed
`FeatureContext` for one feature or one development task
(`featuremap context <feature>`, MCP `get_feature_context` and friends).
It composes four stages:

```text
resolve (graph facts) → rank (tiers + task boost) → budget (tokens) → render
```

It never writes graph rows and never emits full source bodies; entries
carry paths, symbols, roles, spans, relations, and evidence. CLI, MCP,
and future HTTP/IDE surfaces are thin consumers of
`buildFeatureContext(repoRoot, featureNameOrId, options)`.

## 3. Dependency boundaries

### Core

`packages/core` defines domain types and algorithms only.

It must not depend on:

- React
- Fastify
- Drizzle
- framework analyzers
- provider-specific LLM SDKs

### Plugins

Plugins may depend on framework parsers and plugin SDK contracts.

### Consumers

CLI, Web server, MCP, and the context builder consume core services.
`packages/context` depends on core + db only, and is consumed by CLI
and MCP — it must never reverse that direction.

## 4. Scan lifecycle

```text
1. Load config
2. Detect repository root
3. Detect Git base branch
4. Enumerate eligible files
5. Compute hashes / incremental changes
6. Detect technologies
7. Run deterministic analyzers
8. Parse documents/instructions
9. Persist evidence
10. Run semantic grouping only on required evidence
11. Build/update features
12. Compute health and impact
13. Serve/query results
```

## 5. Incremental analysis strategy

MVP correctness comes first, but architecture should support incremental scanning.

Cache key candidates:

```text
file path
file hash
analyzer name
analyzer version
parser version
config fingerprint
```

When a file is unchanged and analyzer/config versions match, reuse previous deterministic evidence.

Semantic inference should be rerun only when its input evidence changes.

## 6. Error isolation

One analyzer failure must not fail the entire scan.

Persist/report analyzer errors with:

- analyzer ID
- file path
- error category
- short message

The UI may show degraded analysis quality.

## 7. LLM boundary

LLM input should be generated from normalized evidence, not arbitrary repository dumps.

Example:

```text
Files:
- src/auth/login.tsx
- src/auth/auth.service.ts

Endpoints:
- POST /api/auth/login

Symbols:
- LoginForm
- AuthService.login

Documents:
- README#Authentication
```

Expected structured output:

```json
{
  "name": "User Login",
  "group": "Authentication",
  "pattern": "Authentication",
  "confidence": 0.94
}
```

## 8. Future Rust boundary

Rust is not part of the MVP.

If profiling later identifies bottlenecks, candidate components to move to Rust are:

- file indexing
- parsing orchestration
- symbol index
- large graph traversal

Keep these behind stable service interfaces so an implementation can change without affecting Web/MCP contracts.

