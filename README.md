# Dynasty GM — Solo Madden Franchise HQ

A Discord assistant for one Madden franchise, one operator, and one server. All retained tools are available without payment or activation. Multiplayer coaching, trading, game-thread management, recognition economies, fantasy, sportsbook, and billing have been removed.

## Run locally

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env`.
3. Set `DISCORD_TOKEN`, `CLIENT_ID`, `MADDEN_SOLO_USER_ID`, and `MADDEN_SOLO_GUILD_ID`.
4. Run `npm run deploy-commands` to replace the franchise server's commands and remove the old global command catalog.
5. Run `npm start`.
6. In Discord, run `/setup`, create Franchise HQ, and connect your franchise using the dashboard.
7. Run `/sync` after advancing in Madden.

Solo operation is permanent. The old `MADDEN_SOLO_MODE=false` flag has no effect. Every command, autocomplete request, and component interaction is restricted to the configured operator and server. Old multiplayer controls return an unavailable message.

The bot needs channel, message, embed, attachment, thread, and role management permissions for setup, reports, and progression notifications. Place its role above the Franchise Manager role. It uses the Guilds gateway intent; message content and member gateway intents are unnecessary.

## Tools

| Purpose | Commands |
| --- | --- |
| Setup | `/setup`, `/setup-channels` |
| Connection | `/connectleague`, `/league-status`, `/disconnectleague`, `/resetleague` |
| Franchise data | `/sync`, `/schedule`, `/roster`, `/playersearch`, `/awards` |
| Draft | `/bigboard`, `/mockdraft`, `/draftexport` |
| Help | `/help`, `/ping` |

Setup creates private **Franchise HQ** and **Franchise Management** channel groups for the operator and bot. It can reuse existing mapped channels and repair their permissions. Unrelated channels and roles are not deleted. Server administrators retain Discord's normal administrative access.

Sync stores the latest franchise snapshot and immutable history with request deduplication. Reports include 21 positional player leaderboards, configurable team ratings, standings, playoff picture, progression recommendations, and a weekly mock draft when a reliable completed regular-season week advances. Draft grading waits for an offseason completion signal or a full rookie class. Draft exports preserve unresolved selections instead of inventing missing picks.

Progression uses team threads in `#player-upgrades`. Apply changes manually in Madden, then mark recommendations Applied or Skipped. The bot does not edit EA player attributes. Rules and rating formulas live in `config/madden_solo_rules.json`.

## Storage and hosting

Set `LB_DATA_ROOT` to a persistent volume (for example `/data`) when hosting. Otherwise runtime storage uses `./data`.

- `madden/leagues/`: franchise snapshots and sync history.
- `guilds/<server-id>/`: channel configuration and EA tokens.
- `leaguebuddy/madden_connections.json`: connection dashboard sessions and imports.
- `draft_classes/madden/`: draft-class reference files.

Bundled draft classes are copied to the data root on startup only when the destination file is absent. Both `bundled_data/draft_classes/` and its `madden/` subdirectory are supported. Existing draft files and historical billing/runtime data are not deleted by this conversion.

Set `LB_PUBLIC_BASE_URL` to the public dashboard URL when hosted. `PORT` enables the shared HTTP listener; `/health` returns 200 while Discord is ready. The dashboard supports EA connection and JSON imports through operator-issued setup links.

Development commands use `.env.dev`; production commands use `.env.prod`. Both deploy only to `MADDEN_SOLO_GUILD_ID`. Use `npm run check:commands` to inspect the command payload without contacting Discord.

## Development

`npm test` runs the solo authorization, command catalog, setup, sync history, progression, report, and draft checks with isolated temporary data roots. Tests do not log into Discord, EA, or payment services.

`src/leaguebuddy/solo_mode.js` defines the shared runtime/deployment command catalog. The app fails startup when either solo ID is missing. Command import failures stop startup and deployment instead of leaving a partial catalog.

`apps/snallabot-service` is retained as a separate reference checkout and is not a workspace dependency or started by this app.
