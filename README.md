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

Sync stores the latest franchise snapshot and immutable history with request deduplication. Reports include 21 positional player leaderboards, configurable team ratings, standings, stat leaders, power rankings, transaction/injury/player change logs, a franchise dashboard, playoff picture, progression recommendations, and a weekly mock draft when a reliable completed regular-season week advances. Draft grades are checked on sync and posted once per draft year during the completed-draft offseason stage when rookie rosters are available; they do not post in preseason. Draft exports include only rookies on the latest team rosters, using matching same-season snapshots to supplement their details. The CSV is formatted as a compact player table for spreadsheets, while JSON retains detailed selection verification data.

On a sync, weekly awards post to the configured Awards channel once for the latest reliable completed regular-season week or playoff round; repeated syncs do not repost it. A completed playoff round can also be detected from its final schedule results when the league enters the offseason. If data or the channel is unavailable, the sync reports why and the next sync can retry.

Progression uses team threads in `#player-upgrades`. Weekly recommendations stay in their team threads, while the pinned progression summary and report boards refresh in place. The weekly target is 20–30 recommendations; if fewer players have qualifying evidence and ratings, fewer are posted and the sync reports the eligible count. Recommendations change up to five evidenced attributes, typically by one point; stronger individual evidence or a sustained streak can increase selected changes. Exceptional weekly award winners rated 70 or below may receive +3 to +5 per supported attribute, even when earlier games pull down their combined score. Each attribute is capped at five points per week and ratings stay within 0–99. Byes do not break a streak, but a recorded game without enough opportunity does. Upgrades and downgrades are balanced when both qualify; no change is invented when evidence is missing. Offensive linemen are excluded because reliable individual blocking statistics are unavailable. Cards explain the stats and performance in plain language. Apply recommendations manually in Madden; new thread posts do not offer Applied or Skipped controls, so newly applied changes are not tracked automatically. The bot does not edit EA player attributes. Rules and rating formulas live in `config/madden_solo_rules.json`.

Team overalls are talent-scaled estimates, not official Madden team ratings: starter-heavy offense and defense and available specialist ratings are scaled around a configurable anchor, then combined with the configured unit weights. Missing return ratings do not prevent special-teams ratings; teams without a rated offense, defense, or specialist remain unranked.

## Storage and hosting

Set `LB_DATA_ROOT` to a persistent volume (for example `/data`) when hosting. Otherwise runtime storage uses `./data`.

- `madden/leagues/`: franchise snapshots and sync history.
- `guilds/<server-id>/`: channel configuration and EA tokens.
- `leaguebuddy/madden_connections.json`: connection dashboard sessions and imports.
- `draft_classes/madden/`: draft-class reference files.

Bundled draft classes are copied to the data root on startup only when the destination file is absent. Both `bundled_data/draft_classes/` and its `madden/` subdirectory are supported. Mock drafts and big boards select CUS01 for season 1, CUS02 for season 2, CUS03 for season 3, and so on. Name subsequent files like `Madden 26 CUS03 - Big Board.json`; a missing class is reported rather than substituting a different season. Bundled classes take precedence over data-root copies, and files directly in the bundled directory take precedence over duplicates in subdirectories. Existing draft files and historical billing/runtime data are not deleted by this conversion.

Set `LB_PUBLIC_BASE_URL` to the public dashboard URL when hosted. `PORT` enables the shared HTTP listener; `/health` returns 200 while Discord is ready. The dashboard supports EA connection and JSON imports through operator-issued setup links.

Development commands use `.env.dev`; production commands use `.env.prod`. Both deploy only to `MADDEN_SOLO_GUILD_ID`. Use `npm run check:commands` to inspect the command payload without contacting Discord.

## Development

`npm test` runs the solo authorization, command catalog, setup, sync history, progression, report, and draft checks with isolated temporary data roots. Tests do not log into Discord, EA, or payment services.

`src/leaguebuddy/solo_mode.js` defines the shared runtime/deployment command catalog. The app fails startup when either solo ID is missing. Command import failures stop startup and deployment instead of leaving a partial catalog.

`apps/snallabot-service` is retained as a separate reference checkout and is not a workspace dependency or started by this app.
