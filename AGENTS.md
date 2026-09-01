# AGENTS.md

This file defines the default implementation rules for coding agents working on FeatureMap.

## 1. Product intent

FeatureMap is a local-first codebase intelligence tool. Its primary abstraction is **Feature**, not File.

The system maps product features to:

- source code
- symbols
- APIs
- data entities
- tests
- documents
- repository instructions
- Git history and current changes

Do not turn FeatureMap into a generic project-management system, issue tracker, or file-tree visualizer.

## 2. MVP boundaries

The MVP supports JavaScript / TypeScript web repositories first.

Primary adapters:

- TypeScript / JavaScript
- React
- Next.js
- Vue
- Express
- NestJS
- Prisma
- Markdown / repository instructions
- Git

Do not add new language ecosystems unless the current task explicitly requires them.

## 3. Architectural invariants

### 3.1 Everything produces Evidence

Analyzers MUST emit normalized `Evidence` records.

They MUST NOT directly mutate UI models or feature detail views.

```text
Source → Analyzer → Evidence → Feature Graph → Consumer
```

### 3.2 Deterministic facts before LLM inference

Use deterministic analysis for facts such as:

- file existence
- symbols
- imports
- exports
- routes
- API paths
- Git history
- changed lines
- test files
- Prisma models
- Markdown headings

Use LLMs only for semantic tasks such as:

- feature naming
- feature grouping
- feature descriptions
- feature pattern classification
- document-to-feature semantic mapping

Never use an LLM as the only authority for call relationships, file existence, or route definitions when deterministic parsing is possible.

### 3.3 Core must be framework-agnostic

`packages/core` MUST NOT import React, Next.js, NestJS, Prisma, Vue, or other framework-specific packages.

Framework knowledge belongs in plugins or analyzers.

### 3.4 Local-first by default

Repository content remains local unless the user explicitly configures an external LLM provider.

Avoid introducing mandatory cloud services into the MVP.

### 3.5 Graceful degradation

Unknown stacks must still receive baseline support:

- files
- directories
- Git
- Markdown docs
- text-level semantic analysis

Do not fail the entire scan because one framework is unsupported.

## 4. Technology constraints

Use:

- Node.js 24 LTS
- TypeScript
- pnpm workspaces
- Fastify
- React + Vite
- SQLite + Drizzle
- Vitest
- Playwright

Prefer native Git CLI through `execa`.

Do not introduce Neo4j in the MVP.

Do not introduce Rust unless profiling proves a concrete scanner or indexing bottleneck.

## 5. Package boundaries

Expected packages:

```text
apps/cli
apps/web
packages/core
packages/scanner
packages/analyzer
packages/db
packages/server
packages/llm
packages/mcp
packages/plugin-sdk
plugins/*
```

Circular dependencies between packages are prohibited.

Recommended dependency direction:

```text
plugin-sdk ← plugins
     ↑
   core
     ↑
scanner/analyzer/db/llm
     ↑
server/mcp/cli/web
```

Adjust only when there is a clear documented reason.

## 6. Data rules

Every inferred relation must include:

- source
- target
- relation type
- evidence source
- confidence
- analyzer/plugin identity

Manual user corrections have the highest authority.

Suggested confidence semantics:

- `1.0`: deterministic fact
- `0.8–0.99`: high-confidence inference
- `0.5–0.79`: plausible inference
- `<0.5`: do not surface as a normal confirmed relation

## 7. Feature health rules

Do not invent opaque percentages such as `87% complete` in the MVP.

Prefer explainable dimensions:

- implementation
- API
- tests
- documentation
- instructions
- documentation drift

## 8. UI rules

Feature UI must communicate **what a feature does**, not merely list files.

Supported initial semantic patterns:

- Authentication
- CRUD
- Workflow
- Event
- Pipeline

Do not create a bespoke renderer for every business feature.

The real product UI, when available, is evidence/preview. It is not the primary feature visualization.

## 9. Change impact rules

`featuremap impact` must begin from Git changes and traverse only evidence-backed relations.

When confidence is low, surface uncertainty explicitly rather than claiming a definite impact.

## 10. Documents and instructions

Treat these as first-class repository knowledge:

- `README.md`
- `AGENTS.md`
- `CLAUDE.md`
- `CONTRIBUTING.md`
- `docs/**/*.md`
- ADRs
- `.github/copilot-instructions.md`
- `.cursor/rules/**`

Repository instructions should be extracted with scope information whenever possible.

## 11. Testing requirements

For every analyzer:

- unit tests for parsing
- fixture repositories
- deterministic snapshots for emitted evidence

For feature discovery:

- golden fixture repositories
- expected feature mappings
- confidence checks

For UI:

- component tests where useful
- Playwright coverage for primary flows

For a bug fix, add a regression test when practical.

## 12. Performance rules

Do not optimize speculatively.

Measure:

- scan duration
- peak memory
- files parsed
- evidence records emitted
- cache hit rate

Prefer incremental rescans based on file hashes and Git diff after correctness is established.

## 13. Security and privacy

Never log:

- source file contents by default
- environment secrets
- `.env` values
- tokens
- API keys

`.env.example` may be analyzed structurally; `.env` should be ignored by default.

External LLM calls must use minimal relevant context rather than sending the entire repository.

## 14. Before completing a task

Run the relevant subset of:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
```

If a command cannot be run, report that explicitly.

## 15. Decision rule

When choosing between a clever abstraction and an explainable evidence path, choose the evidence path.

FeatureMap's credibility depends on users being able to answer:

> Why does the system believe this code belongs to this feature?

