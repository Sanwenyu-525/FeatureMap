# Security and Privacy

FeatureMap analyzes local source repositories, which may contain proprietary code and secrets. Local-first privacy is a product requirement.

## Default behavior

FeatureMap should:

- run locally
- bind the development server to loopback by default
- store indexes locally
- avoid uploading repository content unless an external provider is explicitly enabled
- minimize context sent to configured LLM providers

## Sensitive files

Ignore by default:

```text
.env
.env.*
*.pem
*.key
id_rsa*
.credentials/**
.aws/**
.gnupg/**
```

Allow users to extend ignore rules.

`.env.example` may be parsed structurally, but values should not be treated as secrets or sent externally unnecessarily.

## Logging

Do not log full source contents or secret-bearing configuration by default.

Logs may include:

- relative paths
- analyzer IDs
- timing
- counts
- diagnostic codes

## External LLM providers

When enabled:

1. send only evidence required for the semantic task
2. avoid entire-file/repository uploads when summaries/symbols suffice
3. apply ignore rules before prompt construction
4. clearly identify provider configuration in `featuremap doctor`

## Local API

The local API should bind to `127.0.0.1` by default.

If remote binding is added later, authentication and explicit user configuration are required.

## Vulnerability reporting

Before public release, replace this section with a dedicated disclosure channel.

For the private MVP, document security issues in the project issue tracker and treat repository-content leakage as high priority.

