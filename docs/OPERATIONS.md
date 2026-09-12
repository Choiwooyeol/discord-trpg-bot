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

Starting an adventure now creates a durable `CAMPAIGN` job before contacting the AI. While it runs, the room shows world-generation progress and accepts no player actions. A failure pauses the room with its characters intact; Resume retries the generation. A completed result is persisted before the first scene is committed so restart recovery can reuse it. An interrupted request without a saved result may need another AI request.

Use `npm run check-campaigns` to exercise three openings and a free-form first action with the configured AI. This makes up to five AI requests but uses a separate in-memory session store and sends no Discord messages. Its usage counters are isolated too; account for these diagnostic requests separately from the running bot's daily counter. Inspect the actual outputs for repeated plot types, character integration, and genre consistency. Existing active rooms intentionally retain their opening after an update.
