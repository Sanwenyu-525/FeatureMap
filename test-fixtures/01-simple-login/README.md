# 01-simple-login

Ground-truth fixture for the v0.2 Quality Gate
(docs/releases/v0.2-acceptance.md §2).

A single-feature TypeScript login: an Express endpoint delegates to a
handler, which calls `login()`, which calls `AuthService.login()`,
which calls `UserRepository.findByEmail()`. Shared infrastructure
(`logger`, `http-client`) is imported by feature code but must not be
reported as feature ownership.

This fixture primarily measures **precision under shared-code
pollution** — the Blocker item in the acceptance gate.
