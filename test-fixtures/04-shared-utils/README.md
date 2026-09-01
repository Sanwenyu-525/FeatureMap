# 04-shared-utils

Two features (billing, notification) sharing one infrastructure layer
(`src/shared/`: logger, config, http-client). Acceptance §2 fixture:
shared infrastructure is down-weighted and never surfaces as feature
ownership — it may appear as a low-confidence DEPENDS_ON, never as
`owns`, and shared symbols without their own relational call edges never
become symbol-level candidates.

Ground truths:

- `ground-truth.yaml` — billing
- `ground-truth.notification.yaml` — notification
