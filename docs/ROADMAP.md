# Product roadmap

## Product direction

The bot is for small friend groups who want to start quickly, take unrestricted fictional actions, and keep enough campaign memory to return after days or weeks. The engine, not the model, owns dice, state, delivery, and recovery. The model owns interpretation and narration within that state.

## Shipped foundations

- Durable SQLite sessions, phase guards, outbox delivery, restart recovery, and backups.
- One-player administrator games and multiplayer action collection.
- Random genre campaigns, free-form roles, and English campaign sessions.
- Action history, a lobby guide, `/모험요약`, and `/내로비정리` for recoverable setup mistakes.

## Next: campaign continuity

Persist structured quests, NPCs, factions, reputation, clocks, inventory, and character conditions. Show a compact journal in the session panel and let the AI update only schema-validated changes. This removes the current dependency on a bounded text summary for long campaigns.

## Next: player-facing onboarding

Replace the remaining command-only setup steps with Discord-native guided choices. Add a host setup card for party size, genre, language, tone, and campaign seed; then let players create roles with a guided strength choice. Keep free text available at every stage.

## Next: complete localization

English sessions already use English worlds, AI narration, guidance, and controls. Localize slash-command metadata, all engine feedback, diagnostics, combat reports, and error messages before presenting the project as fully international.

## Later: richer play

Expand combat beyond the current fixed enemy templates, add milestone progression and equipment, support private clues only with explicit party consent, and add host-only checkpoint/rewind tools with audit history.

## Non-goals for now

Do not add unbounded autonomous AI changes to HP, items, rewards, or database state. Do not automatically end progressing games solely because they are old. Do not silently fall back from Codex subscription mode to paid API mode.
