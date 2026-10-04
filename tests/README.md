# Local verification

Run from the repository root with Node.js 18 or newer:

```sh
npm test
```

The suite uses Node's built-in test runner and strict assertions; no new
packages, credentials or running server are required. It exercises the real
shared API router with isolated in-memory storage and session adapters.
Failures return a nonzero exit status.

Coverage: newsletter authentication and permissions, listing/filtering,
status updates and audit persistence, normalization, duplicate subscriptions,
resubscriptions, invalid inputs, malformed JSON, honeypot and rate limiting.

It does not test the login/TOTP handshake, browser UI, filesystem adapters or
live Netlify Blobs. Passing this suite is not proof of a production deployment.
Tests never read or modify the real `data/` directory.

## Deployment budget

Default to local verification. Do not push or deploy merely to run tests.
Netlify's free-plan deployment/resource budget is limited: batch validated
changes and deploy only with explicit user approval. A local Git commit does
not deploy anything. No Netlify API or CLI calls are needed for this suite.
