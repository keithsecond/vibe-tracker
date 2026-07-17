# Vibe-Tracker

Vibe coded job tracker app for 
1. Employment search playwright suite: [Prospects](https://github.com/keithsecond/prospects)
2. Job Evaluator AI bridge: [career-ops](https://github.com/keithsecond/career-ops)

![Project Screenshot](assets/interface.png)

## Installation and usage

```sh
npm install express
```

```sh
node server.js
```

```sh
http://localhost:3000
```

The server reads its data from `../prospects/test-data/jobResults.json` by
default. Override the data source with environment variables:

```sh
DATA_FILE=/path/to/jobResults.json \
DESCRIPTION_DIR=/path/to/description \
PORT=3000 \
node server.js
```

## Testing

Playwright integration tests live in `test/`, split into two tags:

```sh
npm install
npm run test:smoke        # fast, must-always-pass checks
npm run test:regression   # full behavioral coverage
npm test                  # everything
```

Tests never touch real data: each test copies `test/fixtures/` into a
disposable temp dir and points the server at it via `DATA_FILE` /
`DESCRIPTION_DIR` (see `test/helpers/data.js`).

## CI

- **`.github/workflows/pr.yml`** runs both suites on every PR and flags PRs
  that change `server.js` or `public/index.html` without updating a test
  (bypass with the `skip-coverage-gate` label).
- **`.github/workflows/claude-review.yml`** (requires a `CLAUDE_CODE_OAUTH_TOKEN`
  secret from `claude setup-token`, or an API key) suggests tests on a
  `claude-review` label / `@claude` mention, and auto-heals failing CI with
  bounded, human-gated fix commits.
