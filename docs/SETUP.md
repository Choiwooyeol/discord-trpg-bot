# Discord setup

1. Create an application and bot in the Discord Developer Portal.
2. Enable **Message Content Intent** because game actions may be entered as ordinary thread messages.
3. Install the bot to one server with `bot` and `applications.commands` scopes.
4. Give it channel view, send messages, read message history, embed links, create public threads, and send messages in threads permissions.
5. Copy the server ID and one or more lobby channel IDs with Discord developer mode enabled.
6. Copy `.env.example` to `.env` and set `DISCORD_BOT_TOKEN`, `DISCORD_ALLOWED_GUILD_IDS`, and `DISCORD_LOBBY_CHANNEL_IDS`.

Do not paste a token into chat, issues, screenshots, or commits. Run `npm run check` before `npm start`.
