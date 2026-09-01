# FeatureMap MVP Specification

## 1. Problem

AI coding increases code production speed but also accelerates repository entropy. Developers and coding agents can usually find files, but have difficulty answering product-level questions:

- Which files implement a feature?
- Which tests validate it?
- Which docs and repository rules apply?
- What changed recently?
- Which product capabilities may break if a file changes?

The repository contains this information implicitly. FeatureMap makes it explicit.

## 2. MVP hypothesis

Developers will adopt a local tool that automatically organizes a repository around product features if it reduces time spent searching and reconstructing context.

## 3. Primary user

AI-heavy developer or small engineering team working on a TypeScript / JavaScript web application.

Typical characteristics:

- 1–10 engineers
- heavy use of coding agents
- 5k–200k LOC
- Git-based workflow
- React/Vue frontend and Node backend

## 4. Jobs to be done

### JTBD-1: Understand a feature

> When I need to change Login, show me the relevant UI, API, backend, data, tests, docs, and rules without requiring repository-wide search.

### JTBD-2: Understand impact

> When my branch changes code, show me which features may be affected and why.

### JTBD-3: Give an agent focused context

> When a coding agent receives a feature-level task, provide a compact, evidence-backed context package.

## 5. MVP user flow

```text
Install FeatureMap
      ↓
featuremap init
      ↓
featuremap scan
      ↓
Feature discovery
      ↓
featuremap dev
      ↓
Browse feature map
      ↓
Make code changes
      ↓
featuremap impact
```

## 6. Required CLI commands

### `featuremap init`

Creates project configuration.

Output:

- `featuremap.yaml`
- `.featuremap/` runtime/cache directory

### `featuremap scan`

Scans repository and updates local evidence/index.

Options:

```text
--json
--full
--no-llm
```

### `featuremap dev`

Starts local API and Web UI.

Default URL:

```text
http://localhost:7331
```

### `featuremap impact`

Analyzes current changes relative to the configured base branch.

### `featuremap feature <name-or-id>`

Prints feature context in terminal-friendly form.

### `featuremap doctor`

Reports detected project technologies, analyzers, config errors, Git status, and optional LLM configuration.

## 7. Required Web pages

### 7.1 Overview

Show:

- detected technology stack
- feature count
- source file count
- endpoint count
- test count
- docs/instructions count
- feature health summary
- current branch impact summary

### 7.2 Features

Hierarchical feature list grouped into product areas.

Each item shows:

- name
- semantic pattern
- confidence
- health state
- current-change indicator

### 7.3 Feature Detail

Must show:

1. feature name and short description
2. semantic functional flow
3. frontend/backend/API/data assets
4. tests
5. documents
6. applicable instructions
7. evidence explanation
8. recent Git changes
9. current branch impact

### 7.4 Changes

Show:

- changed files
- changed symbols when available
- affected features
- impact confidence
- potentially stale documentation
- applicable repository instructions
- test/document gaps

## 8. Feature patterns in MVP

Only these initial patterns are required:

1. Authentication
2. CRUD
3. Workflow
4. Event
5. Pipeline

The system may classify a feature as `Generic` if confidence is insufficient.

## 9. Feature health

Do not expose opaque completion percentages.

Use explainable states:

```text
Implementation   Complete / Partial / Missing / Unknown
API              Complete / Partial / Missing / N/A
Tests            Present / Partial / Missing / Unknown
Documentation    Present / Partial / Missing
Instructions     Present / Missing / N/A
Doc drift         Clear / Warning / Unknown
```

## 10. Document scope

Must index:

- README files
- `AGENTS.md`
- `CLAUDE.md`
- `CONTRIBUTING.md`
- Markdown under `docs/`
- ADR directories
- `.github/copilot-instructions.md`
- `.cursor/rules/**`

Optional structural files:

- OpenAPI specifications
- `package.json`
- `tsconfig.json`
- `docker-compose.yml`
- `.env.example`

Do not read `.env` values by default.

## 11. MCP MVP

Expose at least:

```text
list_features()
get_feature(feature_id)
get_feature_context(feature_id)
get_affected_features()
get_applicable_instructions(feature_id)
```

`get_feature_context` should return a bounded context package, not raw repository dumps.

## 12. Acceptance tests

A representative fixture repository must allow a developer to answer within 10 seconds:

1. What implements Login?
2. What documents explain Login?
3. What repository rules apply to Login?
4. Which tests cover Login?
5. Which features are affected by the current branch?

## 13. MVP success metrics

Product validation metrics:

- median time to locate feature implementation
- percentage of discovered feature mappings accepted by users
- percentage of impact predictions judged useful
- agent context reduction versus naive repository exploration
- repeat usage of `featuremap dev` / `featuremap impact`

Engineering metrics:

- full scan duration
- incremental scan duration
- peak memory
- evidence count
- analyzer failure rate

