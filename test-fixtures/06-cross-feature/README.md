# 06-cross-feature

Ground-truth fixture for the v0.2 Quality Gate
(docs/releases/v0.2-acceptance.md §2).

Two features — `login` (`POST /api/login`) and `logout`
(`POST /api/logout`) — share one session-service boundary file
(`create()` vs `destroy()`) and one user repository. File-level
closure pulls the shared file into both features; symbol-level
candidates must separate them: `SessionService.create` belongs to
login, `SessionService.destroy` belongs to logout, and neither leaks
into the other feature.

Carries two ground-truth files: `ground-truth.yaml` (login) and
`ground-truth.logout.yaml` (logout).
