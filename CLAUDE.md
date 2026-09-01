# CLAUDE.md

Use `AGENTS.md` as the authoritative repository-wide engineering instruction file.

Additional Claude-specific guidance:

1. Read `README.md`, `AGENTS.md`, and the relevant file under `docs/` before implementing architectural changes.
2. Preserve the invariant: **Analyzer → Evidence → Feature Graph → Consumer**.
3. Do not place framework-specific logic in `packages/core`.
4. Prefer deterministic parsing over semantic guessing.
5. Keep external LLM prompts scoped to the minimum repository context required.
6. Do not introduce unsupported MVP scope without explicitly documenting the decision.
7. Add or update tests for analyzer behavior and evidence output.

