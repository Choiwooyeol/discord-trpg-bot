# GCP deployment

Use a Linux VM with Node.js 24.12 or newer. Copy only the source checkout to the server; keep the production environment file and SQLite database outside the release directory.

```bash
sudo bash deploy/install.sh "$PWD"
sudoedit /etc/discord-trpg-bot.env
sudo bash deploy/install.sh "$PWD"
sudo systemctl status discord-trpg-bot --no-pager
```

The installer uses `/opt/discord-trpg-bot/releases` for immutable code releases and `/opt/discord-trpg-bot/data` for persistent data. It validates the candidate release before switching the `current` symlink and restores the previous release if startup health checks fail.

For Codex mode, perform the official device login as the service user and keep `CODEX_HOME` in a protected persistent directory. Never put the login directory in a source archive.
