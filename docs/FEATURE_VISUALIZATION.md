# Feature Visualization Grammar

## 1. Principle

A Feature view should visually communicate **what the feature does** before showing all implementation details.

Do not render every feature as a generic file list.

Do not imitate the application's real UI unless the real UI is being shown as a separate preview/evidence surface.

## 2. Two-layer model

### Product view

Answers:

- What does this feature mean?
- What is the flow?
- What state is it in?
- What related capabilities exist?

### Engineering view

Answers:

- Which files implement it?
- Which endpoint handles it?
- Which data does it touch?
- Which tests/docs/rules apply?

## 3. Initial patterns

### Authentication

Typical semantic nodes:

```text
User
 ↓
Credentials / Identity
 ↓
Authentication
 ↓
Session / Token
```

Examples:

- Login
- Registration
- Password reset
- OAuth

### CRUD

```text
Actor
 ↓
Create / Read / Update / Delete
 ↓
Domain Entity
 ↓
Persistence
```

### Workflow

```text
Start
 ↓
Step A
 ↓
Decision
 ↓
Step B
 ↓
Completion
```

Examples:

- Checkout
- Approval
- Onboarding

### Event

```text
Trigger
 ↓
Event
 ↓
Handler / Queue
 ├─ Channel A
 └─ Channel B
```

Examples:

- Notifications
- Webhooks
- async jobs

### Pipeline

```text
Input
 ↓
Validation
 ↓
Processing
 ↓
Storage / Output
```

Examples:

- Upload
- Import
- Media processing

## 4. Feature Detail layout

Recommended information order:

```text
[Feature identity]
[Semantic flow]
[Health]
[Implementation assets]
[Tests]
[Documentation]
[Instructions]
[Evidence explanation]
[Recent changes]
```

## 5. Visual semantics

Use consistent visual categories for node types rather than business-specific one-off styling.

Suggested node categories:

- Actor
- UI
- API
- Service
- Data
- Event
- External system
- Test
- Document
- Rule

## 6. Confidence display

Low-confidence inferred mappings must be visually distinguishable from deterministic relations.

Recommended labels:

- Confirmed
- Inferred
- Uncertain

Avoid presenting confidence as a decorative number without explanation.

## 7. Explainability interaction

Every relationship should support a "Why?" inspection.

Example:

```text
Why is AuthService.ts part of Login?

LoginForm.tsx
  → POST /api/auth/login
  → AuthController.login
  → AuthService.login
```

This interaction is more important than building a visually dense global graph.

