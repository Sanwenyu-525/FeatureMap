# 05-monorepo

Ground-truth fixture for the v0.2 Quality Gate
(docs/releases/v0.2-acceptance.md §2, §11).

A pnpm-workspace-style monorepo: the web app's login endpoint and page
import the auth package through the root tsconfig path alias
`@company/auth/*`, which resolves to the real package sources under
`packages/auth/src`. Two same-named `utils.ts` files (one per
workspace) verify workspace identity — neither is imported, so neither
may surface as a candidate or collide with the other.

This fixture primarily measures **cross-package relation building and
workspace identity**.
