# Contributing

Use Node.js 24.12 or newer. Keep the dependency-free Node.js architecture unless a new dependency has a clear need.

Before opening a pull request, run:

```bash
npm test
npm run check
npm run public-check
```

Include regression tests for session state, duplicate Discord delivery, restart recovery, or AI contracts when the change affects them. Remove tokens, IDs, player data, and SQLite files from logs and examples.
