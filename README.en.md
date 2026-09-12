# Discord TRPG Bot

A self-hosted Korean AI TRPG bot for small Discord groups. It keeps sessions, player actions, dice outcomes, and Discord delivery state in SQLite so games recover safely after restarts.

## Highlights

- Random campaigns in fantasy, science fiction, martial arts, cyberpunk, and mystery genres
- AI-generated openings based on the prepared party’s roles, specialties, and weaknesses; recent starts and opening situations guide variety
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

Create a room with `/게임시작` (or administrator-only `/혼자시작`), choose your role, mark ready, and let the host start. The AI then creates the setting and opening. Continue using the new scene’s buttons or a free-form chat action; suggested quests are optional. Use `//` for chatter.

Starting uses one AI request. If generation fails, characters remain saved and the host can press Resume to retry, using another request. Existing adventures keep their worlds across updates and resumes. Recent openings help reduce repetition; semantic uniqueness is not guaranteed. Exact repeated openings or location/premise pairs are rejected instead of silently substituting a canned scene.

`npm run check-campaigns` runs three live AI openings and one first-action continuation (up to five requests) with an isolated in-memory game database and no Discord messages. Read the generated scenes to assess variety; offline tests alone do not establish story quality.

Released under the [MIT License](LICENSE).
