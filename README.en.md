# Discord TRPG Bot

A self-hosted Korean AI TRPG bot for small Discord groups. It keeps sessions, player actions, dice outcomes, and Discord delivery state in SQLite so games recover safely after restarts.

## Highlights

- Random campaigns in fantasy, science fiction, martial arts, cyberpunk, and mystery genres
- Free-form character roles such as a family retainer, mining technician, or netrunner
- Solo administrator mode and 2–6 player sessions
- Button choices, free-form actions, conflict voting, turn-based combat, and durable story history
- English campaign worlds and AI narration when the host selects English at game creation
- Codex subscription mode or an operator-provided OpenAI API configuration

## Quick start

Requires Node.js 24.12 or newer and a Discord application.

```powershell
Copy-Item .env.example .env
# Add your Discord settings to .env.
npm run check
npm test
npm start
```

See [Discord setup](docs/SETUP.md), [GCP deployment](docs/GCP_DEPLOY.md), and the Korean [README](README.md) for full operating details. Never commit `.env`, SQLite files, backups, or Codex login data.

Released under the [MIT License](LICENSE).
