# Security

## Reporting A Vulnerability

Please report security issues through GitHub private vulnerability reporting for this repository.

If private reporting is not available, open a public issue with only a minimal description and ask for a private contact path. Do not include exploit details, secrets, logs with tokens, or private repository paths in a public issue.

## Project Security Expectations

- Runtime HTTP endpoints are local-only and mutating routes require bearer auth.
- Project state is local-first and stored in the target repo under `.steward/state.db`.
- App/runtime tokens and logs live outside the repo by default under `~/.steward/`.
- Agent I/O logging is off by default because prompts may include sensitive project context.

## Supported Versions

This project is pre-1.0. Security fixes target `main`.
