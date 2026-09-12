# Security policy

Keep Discord bot tokens, Discord IDs, Codex login data, SQLite databases, and server environment files private. Never commit `.env`, `data/`, `*.sqlite`, or a Codex home directory.

Run `npm run public-check` before pushing. It checks required public files, common Discord-token patterns, local deployment identifiers, and tracked secret files.

If a bot token is exposed, reset it in the Discord Developer Portal immediately and replace it in every deployed environment. Removing it from a commit does not make it safe again.

Report security issues privately to the repository owner. Do not include live tokens, player messages, or database files in issues.
