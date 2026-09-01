# 03-nextjs-auth

Ground-truth fixture for the v0.2 Quality Gate
(docs/releases/v0.2-acceptance.md §2).

A Next.js-style auth slice: an Express custom server registers the
login route (relative import), while the app-side chain (route →
lib/auth → services/auth → repositories/user, plus the login page and
hook) imports exclusively through the `@/*` tsconfig path alias.

This fixture primarily measures **specifier resolution** — tsconfig
`paths` support is a Blocker item of the acceptance gate; without it
the app-side chain is undiscoverable.
