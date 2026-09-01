# 02-react-login

Ground-truth fixture for the v0.2 Quality Gate
(docs/releases/v0.2-acceptance.md §2).

A React login UI (LoginPage → LoginForm, useLogin hook) backed by an
Express endpoint and an auth service chain. Shared UI primitives
(`Button`, `PasswordInput`) render inside the feature but must not be
reported as feature ownership — technical dependency is not feature
ownership.

This fixture primarily measures **recall from the UI side**: the
component tree is reachable only via the declared file anchor and
component-usage traversal.
