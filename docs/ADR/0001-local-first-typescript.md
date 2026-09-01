# ADR-0001: Local-first TypeScript architecture for MVP

- Status: Accepted
- Scope: MVP

## Context

FeatureMap requires:

- a CLI
- repository scanning
- JavaScript/TypeScript analysis
- a local HTTP server
- a browser UI
- MCP integration
- extensible analyzers

The product has not yet validated demand, so development speed and architectural clarity are more important than maximum parsing throughput.

## Decision

The MVP will use TypeScript across the primary runtime stack:

- Node.js 24 LTS
- pnpm workspaces
- Fastify
- React + Vite
- SQLite + Drizzle
- TypeScript Compiler API
- Tree-sitter as cross-language/fallback parsing infrastructure
- MCP TypeScript SDK

The application is local-first and does not require a hosted backend.

Rust will not be introduced in the MVP.

## Rationale

Advantages:

- one language across CLI, server, analyzers, and MCP
- strong TypeScript tooling for the first supported ecosystem
- fast iteration
- easier package sharing
- simpler debugging and onboarding

The main risk is scanner/indexing performance on very large repositories. This is acceptable for the MVP target range.

## Consequences

Architecture must keep performance-sensitive boundaries replaceable.

Potential future Rust candidates:

- file indexing
- parsing orchestration
- symbol indexing
- graph traversal

Consumer contracts (CLI/Web/MCP) should not depend on parser implementation details.

