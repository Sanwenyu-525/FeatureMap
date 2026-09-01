# FeatureMap

> A local-first codebase intelligence layer that organizes code, tests, APIs, data, documents, rules, and Git changes by **product feature**.

FeatureMap is built for AI-heavy software development. As coding agents produce code faster, repositories become harder to understand at the product level. FeatureMap answers questions such as:

- What code implements **Login**?
- Which APIs, tests, data entities, and documents belong to that feature?
- Which `AGENTS.md` / `CLAUDE.md` rules apply before changing it?
- What features are affected by my current Git diff?
- What context should a coding agent load before modifying this feature?

## MVP Product Principle

FeatureMap is **not** a file-tree visualizer and **not** a project-management tool.

Its core model is:

```text
Feature
├── Meaning / Flow
├── Code
├── APIs
├── Data
├── Tests
├── Documentation
├── Agent Instructions
└── Git History / Current Changes
```

The product should feel closer to **Swagger for product features**, with a local web UI plus CLI and MCP access.

## MVP Scope

### Supported repository types

The MVP targets JavaScript / TypeScript web applications, especially:

- React
- Next.js
- Vue
- Express
- NestJS
- Prisma
- REST APIs
- Git repositories

Unsupported stacks must degrade gracefully to file, Git, document, and semantic analysis instead of failing completely.

### Core MVP capabilities

1. **Repository scanning**
   - Detect project structure and technologies.
   - Parse files, symbols, imports, routes, docs, Git history, and current diff.

2. **Feature discovery**
   - Group repository evidence into product features.
   - Assign a feature name, description, pattern, confidence, and health status.

3. **Feature → implementation mapping**
   - Map a feature to frontend, backend, API, data, tests, docs, and instructions.

4. **Change impact analysis**
   - Map changed files / symbols to affected features.

5. **Local Web UI**
   - Overview
   - Features
   - Feature Detail
   - Changes

6. **MCP integration**
   - Expose feature context to coding agents.

## Non-goals for MVP

The MVP does **not** include:

- SaaS collaboration
- GitHub App / GitLab App
- Jira / Linear integration
- Enterprise RBAC
- Multi-repository product graphs
- Runtime tracing
- Full static call graph for every language
- VS Code / JetBrains plugins
- Neo4j
- AI autonomous code modification
- Support for every programming language

## Recommended Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 24 LTS |
| Language | TypeScript |
| Workspace | pnpm workspaces |
| CLI | Commander + execa |
| Local server | Fastify |
| Web | React + Vite |
| Diagram UI | `@xyflow/react` |
| Styling | Tailwind CSS + shadcn/ui |
| Local database | SQLite |
| Database access | Drizzle ORM |
| TypeScript analysis | TypeScript Compiler API |
| Cross-language parser | Tree-sitter |
| Vue analysis | `@vue/compiler-sfc` |
| Markdown analysis | remark / mdast |
| Git | native `git` CLI via execa |
| Tests | Vitest + Playwright |
| Agent integration | MCP TypeScript SDK |

## Repository Layout

```text
featuremap/
├── apps/
│   ├── cli/
│   └── web/
├── packages/
│   ├── core/
│   ├── scanner/
│   ├── analyzer/
│   ├── db/
│   ├── server/
│   ├── llm/
│   ├── mcp/
│   └── plugin-sdk/
├── plugins/
│   ├── typescript/
│   ├── react/
│   ├── nextjs/
│   ├── vue/
│   ├── express/
│   ├── nestjs/
│   ├── prisma/
│   └── markdown/
└── docs/
```

## Target CLI

```bash
featuremap init
featuremap scan
featuremap scan --json
featuremap dev
featuremap impact
featuremap feature login
featuremap doctor
```

### Expected first-run flow

```bash
cd my-project
featuremap init
featuremap dev
```

Expected output:

```text
Scanning repository...

Languages
✓ TypeScript

Frameworks
✓ React
✓ NestJS
✓ Prisma

Documents
✓ README.md
✓ AGENTS.md

Git
✓ 628 commits

Features discovered
✓ 14

Open http://localhost:7331
```

## Core Engineering Rule

**Everything produces Evidence.**

Framework analyzers, Git analyzers, document analyzers, and semantic models must not write directly into UI-specific structures.

```text
Analyzer
   ↓
Evidence[]
   ↓
Feature Graph
   ↓
CLI / Web / MCP
```

This boundary is the most important architectural rule in the project.

## Documentation

- [MVP specification](docs/MVP_SPEC.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Data model](docs/DATA_MODEL.md)
- [Analyzer and plugin specification](docs/ANALYZER_PLUGIN_SPEC.md)
- [Feature visualization grammar](docs/FEATURE_VISUALIZATION.md)
- [Development plan](docs/DEVELOPMENT_PLAN.md)
- [Testing strategy](docs/TESTING_STRATEGY.md)
- [Local API specification](docs/API_SPEC.md)
- [MCP specification](docs/MCP_SPEC.md)
- [Security and privacy](SECURITY.md)
- [ADR-0001: Local-first TypeScript architecture](docs/ADR/0001-local-first-typescript.md)

## Success Criteria

The MVP is successful when a developer can answer these questions in under 10 seconds:

1. What implements the Login feature?
2. Which feature is affected by this changed file?
3. Which tests and docs belong to Task Reminder?
4. Which repository rules apply before changing Authentication?
5. Can a coding agent retrieve focused feature context without scanning the whole repository itself?

