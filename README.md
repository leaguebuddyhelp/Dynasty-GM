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

Running `/setup` on an existing Franchise HQ adds the Weekly Top 100, Yearly Top 100, and All-Pro Teams channels if they are missing. Initial setup still uses Create Franchise HQ. The weekly board updates on sync and shows ten players per page. Weekly results are stored by season; missing earlier weeks can be reconstructed from available snapshot data, using the roster available at sync time. After the regular season, the yearly board and first- and second-team All-Pro boards are published when results for all 18 weeks are available. The yearly grade is 90% average weekly Top 100 grade plus up to 10 points for appearances across the 18 weeks. Each All-Pro team has two WRs and two CBs, one player at each other listed position, and no FB. The highest-ranked players from the yearly Top 100 fill the first team before the second; slots without enough qualifying players remain vacant.

Player-overall boards rank players using a separate performance-adjusted **form** rating, while displaying their actual imported Madden OVR alongside it. Form uses the latest played game's performance (65%), the recent four-game average (35%), supported positive or negative evidence, and bonuses for sustained play, young players and multiple recent weekly awards. The adjustment is capped at five points above or below Madden OVR; unsupported changes are omitted. It is an app estimate, not EA's official rating or an automatic attribute edit.

During offseason syncs, each team progression thread also receives a season OVR change summary showing up to ten increases and ten decreases in actual Madden overall. It compares the earliest saved preseason or regular-season roster with the latest offseason roster, assigning players to their current team. If the earliest snapshot is after Week 1, the summary labels the comparison as partial; if no season snapshot is available, it says so. Players without a matching starting rating are excluded, and subsequent offseason syncs update the same message after manual changes are applied in Madden.

Weekly recommendations can also include Awareness for strong games with sufficient playing opportunity and an imported Awareness rating. Awareness rotates with other evidenced attributes; its game-performance score is an estimate, not a directly measured awareness statistic.

Progression uses team threads in `#player-upgrades`. Weekly recommendations stay in their team threads, while the pinned progression summary and report boards refresh in place. The weekly target is 20–30 recommendations; if fewer players have qualifying evidence and ratings, fewer are posted and the sync reports the eligible count. Recommendations change up to five evidenced attributes, typically by one point; stronger individual evidence or a sustained streak can increase selected changes. Exceptional weekly award winners rated 70 or below may receive +3 to +5 per supported attribute, even when earlier games pull down their combined score. Each attribute is capped at five points per week and ratings stay within 0–99. Byes do not break a streak, but a recorded game without enough opportunity does. Upgrades and downgrades are balanced when both qualify, with eligible position groups spread across the selection; no change is invented when evidence is missing. For offensive linemen, the highest-rated player at each position who is not listed as injured is an estimated starter. The current week's team rushing efficiency and sack rate are explicitly labeled proxies, not individual blocking stats; missing data is not treated as zero and previous starters are not inferred. Kickers and punters use their own attempts, accuracy and distance. Not every attribute can be evaluated from available exports. Cards explain the stats and performance in plain language. Apply recommendations manually in Madden; new thread posts do not offer Applied or Skipped controls, so newly applied changes are not tracked automatically. The bot does not edit EA player attributes. Rules and rating formulas live in `config/madden_solo_rules.json`.

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
