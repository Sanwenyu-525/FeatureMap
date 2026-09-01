# Analyzer and Plugin Specification

## 1. Goal

Framework support must be extensible without changing FeatureMap core.

A plugin detects a technology and emits normalized Evidence.

## 2. Minimal interface

```ts
export interface AnalyzerPlugin {
  id: string;
  version: string;

  detect(context: DetectContext): Promise<DetectionResult>;

  analyze(context: AnalyzeContext): Promise<AnalyzerResult>;
}
```

### DetectionResult

```ts
interface DetectionResult {
  detected: boolean;
  confidence: number;
  metadata?: Record<string, unknown>;
}
```

### AnalyzerResult

```ts
interface AnalyzerResult {
  assets: CodeAssetInput[];
  evidence: EvidenceInput[];
  diagnostics: AnalyzerDiagnostic[];
}
```

## 3. Analyzer categories

### Universal analyzers

Always available:

- filesystem
- Git
- Markdown/documents
- text search

### Language analyzers

Examples:

- TypeScript/JavaScript
- future Java/Python/Go/Rust

### Framework analyzers

Examples:

- React
- Next.js
- Vue
- Express
- NestJS

### Data analyzers

Examples:

- Prisma
- future SQL/ORM adapters

## 4. TypeScript analyzer responsibilities

Use the TypeScript Compiler API to extract:

- imports / exports
- functions
- classes
- methods
- symbol names
- call expressions where resolvable
- source locations

Output normalized assets and relations.

## 5. Tree-sitter role

Tree-sitter is the cross-language parser/fallback layer.

It should not replace higher-fidelity language tooling when better semantic APIs exist.

## 6. React analyzer

Initial extraction targets:

- components
- route/page files
- hooks
- API request callsites
- component-to-service references

Do not attempt full runtime component tree reconstruction in MVP.

## 7. Next.js analyzer

Initial extraction targets:

- App Router pages/layouts
- Pages Router pages
- route handlers
- API routes
- server actions when detectable

## 8. NestJS analyzer

Initial extraction targets:

- controllers
- route decorators
- providers/services
- repositories
- controller → service references

Example deterministic evidence:

```text
POST /auth/login
HANDLED_BY
AuthController.login
```

## 9. Prisma analyzer

Parse `schema.prisma` and emit:

- data model assets
- model names
- relations

Map code references to models where deterministic evidence exists.

## 10. Markdown/document analyzer

Parse Markdown into AST sections.

Extract:

- title
- headings
- scoped instructions
- explicit file/feature references
- architecture decisions

Semantic inference may map sections to features after deterministic parsing.

## 11. Plugin failure behavior

Plugin failures must be isolated.

Return diagnostics rather than throwing an unhandled process-level error when possible.

```ts
interface AnalyzerDiagnostic {
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  path?: string;
}
```

## 12. Plugin fixtures

Every plugin should contain fixtures:

```text
plugins/nestjs/
├── src/
└── fixtures/
    ├── basic-controller/
    ├── nested-modules/
    └── ambiguous-route/
```

Expected evidence should be asserted explicitly.

