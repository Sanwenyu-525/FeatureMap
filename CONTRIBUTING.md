# Contributing to FeatureMap

## Development setup

Requirements:

- Node.js 24 LTS
- pnpm
- Git

Install dependencies:

```bash
pnpm install
```

Common commands:

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
```

## Before contributing

Read:

1. `AGENTS.md`
2. `docs/MVP_SPEC.md`
3. `docs/ARCHITECTURE.md`
4. `docs/DATA_MODEL.md`

For analyzer/plugin work, also read `docs/ANALYZER_PLUGIN_SPEC.md`.

## Change categories

### Core model changes

Changes to Feature, Evidence, Relation, Document, Instruction, or CodeAsset require:

- schema review
- migration impact review
- tests
- documentation update

### Analyzer changes

Analyzer PRs should include:

- a fixture repository or fixture files
- expected Evidence output
- unsupported/ambiguous cases
- confidence behavior

### UI changes

UI changes should preserve:

- product-semantic feature visualization
- evidence explainability
- clear confidence/uncertainty states

## Commit guidance

Use concise commits with product meaning when possible:

```text
feat(scanner): detect TypeScript project structure
feat(nestjs): extract controller routes
feat(docs): parse scoped AGENTS instructions
fix(impact): avoid low-confidence transitive feature hit
```

## Pull request checklist

- [ ] Scope matches MVP or is explicitly justified.
- [ ] No framework-specific logic leaked into core.
- [ ] New inference includes evidence and confidence.
- [ ] Tests cover new behavior.
- [ ] User-facing behavior is documented.
- [ ] No source/secrets are logged accidentally.

