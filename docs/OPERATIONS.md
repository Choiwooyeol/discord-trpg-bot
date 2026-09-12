# Operations

Run these commands from the release directory or local checkout:

```bash
npm run status
npm run backup
npm test
npm run check
```

Game state is stored in SQLite. Back up the database before manual recovery work. A paused session can be resumed by its host; stale buttons are rejected by the session phase guard. Do not delete a live database or an active release directory to recover a stuck room.

If Discord connectivity fails, check the system service log and bot token configuration. If Codex authentication fails, repair the official Codex login for the service account; the bot does not silently switch to a paid API.
