# Testing Strategy

## 1. Testing philosophy

FeatureMap makes structural and semantic claims about repositories. False confidence is worse than incomplete analysis.

Tests should therefore focus on:

- deterministic analyzer correctness
- evidence stability
- graceful degradation
- explainability
- regression prevention

## 2. Unit tests

Use Vitest.

Cover:

- path normalization
- ignore rules
- confidence utilities
- graph traversal
- feature health derivation
- parser helpers
- config loading

## 3. Analyzer fixture tests

Every analyzer should run against fixture projects.

Example:

```text
test-fixtures/
├── react-express-basic/
├── next-nest-prisma/
├── vue-express/
└── docs-heavy-repo/
```

Assertions should focus on emitted Evidence rather than internal implementation.

Example:

```text
POST /api/login
HANDLED_BY
AuthController.login
confidence = 1.0
```

## 4. Golden repository tests

Maintain a small set of representative repositories with expected feature maps.

Validate:

- discovered feature names/groups
- expected key asset mappings
- unexpected high-confidence mappings
- instruction scope
- change impact

Semantic outputs may allow bounded variation where model providers differ.

### 4.1 Ground-truth fixtures and mapping quality (v0.2)

`test-fixtures/01-simple-login` – `06-cross-feature` carry a
`ground-truth.yaml` each: `expected` / `notExpected` symbol lists plus
`expectedFiles` / `notExpectedFiles`, as defined in
docs/releases/v0.2-acceptance.md §2.

`@featuremap/pipeline` exports `loadGroundTruth`, `measureFileMapping`
and `measureSymbolMapping` (packages/pipeline/src/mapping-quality.ts):
they compare a scan's `BELONGS_TO_FEATURE` evidence against the ground
truth and report Precision/Recall with the exact misclassified
candidates. Candidates that are neither expected nor notExpected count
as false positives (precision-first) and are listed as a ground-truth
gap.

File-level metrics run against the current engine; symbol-level
metrics report `pending: true` until the anchor-driven candidate
engine (Milestone 7) emits symbol-level mappings. The fixture tests
pin the *current* engine's known gaps as regression baselines —
01: shared-infrastructure precision pollution; 02: UI component tree
unreachable from endpoint anchors; 03: tsconfig path aliases
unresolved. When Milestone 7 lands, these flip into the Quality Gate
thresholds (core fixtures Precision ≥ 85% / Recall ≥ 70%).

## 5. LLM tests

Do not make core test suites depend on live external LLM APIs.

Use:

- provider mocks
- captured structured responses
- schema validation
- optional non-blocking integration suites for real providers

## 6. CLI tests

Cover:

```text
featuremap init
featuremap scan --json
featuremap feature
featuremap impact
featuremap doctor
```

Use temporary fixture repositories.

## 7. Web E2E tests

Use Playwright for:

1. opening Overview
2. browsing feature list
3. opening Feature Detail
4. viewing evidence explanation
5. viewing current branch impact

## 8. Performance baselines

Track representative repositories:

```text
small    ~5k LOC
medium   ~50k LOC
large    ~200k LOC
```

Record:

- cold scan duration
- incremental scan duration
- peak RSS
- evidence count
- SQLite size

These are baselines, not hard SLA targets during early MVP work.

## 9. Privacy tests

Verify by test that default scanning ignores or redacts sensitive sources such as:

- `.env`
- common credential files
- token directories

Verify logs do not include full source content by default.

