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
| Setup | `/setup` |
| Connection | `/league-status`, `/disconnectleague confirm:true` |
| Franchise data | `/sync`, `/schedule`, `/roster`, `/playersearch`, `/awards` |
| Draft | `/bigboard`, `/mockdraft`, `/draftexport` |
| Help | `/help`, `/ping` |

Setup creates private **Franchise HQ** and **Franchise Management** channel groups for the operator and bot. It can reuse existing mapped channels and repair their permissions. Unrelated channels and roles are not deleted. Server administrators retain Discord's normal administrative access.

Sync stores the latest franchise snapshot and immutable history with request deduplication. Reports include 21 positional player leaderboards, configurable team ratings, standings, stat leaders, power rankings, transaction/injury/player change logs, a franchise dashboard, playoff picture, progression recommendations, and a weekly mock draft for the latest reliable completed regular-season week, each playoff week, and each offseason stage/week. The first eligible period can be posted on an initial sync; a later sync retries a failed post and successful posts are not duplicated within the same season and period. Preseason does not repost stale mocks. Draft grades are checked on sync and posted once per draft year during the completed-draft offseason stage when rookie rosters are available; they do not post in preseason. Draft exports include only rookies on the latest team rosters, using matching same-season snapshots to supplement their details. The CSV is formatted as a compact player table for spreadsheets, while JSON retains detailed selection verification data.

On a sync, weekly awards post to the configured Awards channel once for the latest reliable completed regular-season week or playoff round; repeated syncs do not repost it. A completed playoff round can also be detected from its final schedule results when the league enters the offseason. If data or the channel is unavailable, the sync reports why and the next sync can retry.

Weekly award winners, including offensive and defensive rookies, are prioritized for an upgrade in their team progression thread when a recorded stat supports an available attribute rating. Award winners are not displaced by the normal weekly recommendation cap; multiple awards for the same player produce one recommendation. If a winner cannot be matched or lacks supported evidence or ratings, the progression summary lists them for review instead of inventing an upgrade. Playoff award winners use the corresponding playoff statistics.

Draft exports exclude rookies explicitly marked undrafted by Madden's round 64, pick 0 sentinel. Players with incomplete selection data or conflicting pick numbers remain in the export rather than being removed without proof.

Running `/setup` on an existing Franchise HQ adds the Weekly Top 100, Yearly Top 100, and All-Pro Teams channels if they are missing. Initial setup still uses Create Franchise HQ. The weekly board updates on sync and shows ten players per page. Weekly results are stored by season; missing earlier weeks can be reconstructed from available snapshot data, using the roster available at sync time. After the regular season, the yearly board and first- and second-team All-Pro boards are published when results for all 18 weeks are available. The yearly grade is 90% average weekly Top 100 grade plus up to 10 points for appearances across the 18 weeks. Each All-Pro team has two WRs and two CBs, one player at each other listed position, and no FB. The highest-ranked players from the yearly Top 100 fill the first team before the second; slots without enough qualifying players remain vacant.

Player-overall boards rank the top ten players at each position by their imported Madden overall, displaying one OVR per player. Ratings change when updated Madden rosters are synced.

At the start of playoffs, each team progression thread receives its Top 10 OVR risers and Top 10 fallers. These lists compare actual imported Madden OVR against the earliest saved preseason or regular-season roster and update in place on later playoff and offseason syncs. A baseline after Week 1 is labeled partial; unmatched players are excluded. No projected OVR changes are invented.


Weekly recommendations can also include Awareness for strong games with sufficient playing opportunity and an imported Awareness rating. Awareness rotates with other evidenced attributes; its game-performance score is an estimate, not a directly measured awareness statistic.

Ratings change through weekly gameplay recommendations only. There is no bulk season-end or offseason rating batch, and missing-stat inactivity does not trigger a downgrade. The first playoff sync explicitly evaluates completed regular-season Week 18 and posts every team’s OVR lists; it ignores upcoming playoff placeholders. Later playoff evaluations include only teams that played the completed target round, excluding bye and eliminated teams even when stale stat rows remain. The active regular-season week is never evaluated early. Offseason syncs refresh the OVR lists without creating new rating changes.

Two qualifying games scoring at least 75 earn one extra point on up to two evidenced attributes; two verified poor games and a current score of 28 or below can strengthen supported downgrades. Current-game quality must support the direction: old strong games cannot upgrade a player after poor current play, and old poor games cannot downgrade a player after a strong current game. Missing usage, missing ratings, and injuries protect against unsupported penalties. Offensive-line proxies keep their existing measured limits and do not receive the extra individual-gameplay bonus. At least three verified poor games can still support an explicitly estimated Awareness adjustment when direct negative evidence is unavailable.

A small selection penalty for players featured in the previous three weeks gives other deserving players a chance; consistent elite or poor performers remain eligible. A weekly report retains its original attribute targets on repeated syncs, including after manual Madden edits, so the same performance does not issue a second boost. Underfilled reports, including older frozen reports, can add newly supported players without changing those issued targets. New weekly award winners retain their existing review path.


Progression uses team threads in `#player-upgrades`. Weekly recommendations stay in their team threads. Each new weekly report also posts a team-link index in `#player-upgrades`, and the season’s Top 10 lists have their own team-link index there. Repeat syncs update those indexes. The Data Imports confirmation includes upgrade/downgrade counts and direct links to both indexes, so edited older cards remain easy to find. Existing reports receive missing indexes after an app upgrade without contacting EA or applying additional rating changes. The weekly target is 20–30 combined upgrade and downgrade recommendations; when fewer than 20 meet the primary cutoffs, smaller one-point changes on up to two evidenced attributes can fill remaining places from above-average (60+) or poor (45 or below) gameplay. This fallback still requires current usage, ratings, and attribute evidence; it never changes nonparticipants or invents missing statistics. OVR-list posting failures are reported independently and retried without blocking weekly changes; missing old archives are skipped when choosing a baseline. If fewer players have qualifying evidence and ratings, fewer are posted and the sync reports the eligible count. Recommendations change up to five evidenced attributes, by one to five points; stronger individual evidence or a sustained streak can increase selected changes. Exceptional weekly award winners rated 70 or below may receive +3 to +5 per supported attribute, even when earlier games pull down their combined score. Each attribute is capped at five points per week and ratings stay within 0–99. Byes do not break a streak, but a recorded game without enough opportunity does. Upgrades and downgrades are balanced when both qualify, with eligible position groups spread across the selection; no change is invented when evidence is missing. For offensive linemen, the highest-rated player at each position who is not listed as injured is an estimated starter. The current week's team rushing efficiency and sack rate are explicitly labeled proxies, not individual blocking stats; missing data is not treated as zero and previous starters are not inferred. Kickers and punters use their own attempts, accuracy and distance. Not every attribute can be evaluated from available exports. Cards explain the stats and performance in plain language. Apply recommendations manually in Madden; new thread posts do not offer Applied or Skipped controls, so newly applied changes are not tracked automatically. The bot does not edit EA player attributes. Rules and rating formulas live in `config/madden_solo_rules.json`.

Team overalls are talent-scaled estimates, not official Madden team ratings: starter-heavy offense and defense and available specialist ratings are scaled around a configurable anchor, then combined with the configured unit weights. Missing return ratings do not prevent special-teams ratings; teams without a rated offense, defense, or specialist remain unranked.

## Storage and hosting

Progression supports movement across the 80 and 90 OVR bands. Three consecutive qualifying games scoring at least 82, with a recent average of at least 82, limit the season-guideline selection penalty to 8 so earlier earned upgrades do not stall continued excellent play. Offseason relief requires at least eight qualifying games, a season score of at least 82, and at least 60% of qualifying games scoring 82 or higher. Population targets remain soft selection modifiers. Players rated 90+ remain eligible for evidence-based downgrades. Maxed attributes are skipped so other supported attributes can improve. Configure these rules under `progression.sustainedGrowth` in `config/madden_solo_rules.json`.

These are attribute recommendations: apply them in Madden, then sync the recalculated OVR. The app does not assume an attribute point equals an OVR point or automatically edit EA player ratings.

Rookie development tracking covers every rostered player whose imported `yearsPro` is zero, including players who lack statistics or an available recommendation slot. Imported OVR, season baseline changes, qualifying usage, scores, injury status, and recommendation status are retained internally. Rookie recap messages are no longer posted; normal player upgrade and downgrade recommendations continue in the team threads.

Rookie trajectories are evaluated from performance rather than assigned at random. Two qualifying games scoring at least 85 establish a boom trajectory; three consecutive verified poor games (score 34 or below) establish a bust trajectory. Other rookies with at least three qualifying games are classified as average; insufficient evidence, injuries, and offensive-line proxies remain under monitoring. First- and second-round picks (or verified top-64 overall picks) receive six extra selection-priority points and one extra primary-attribute point in the earned direction. Busts receive three additional priority points at any draft position. Rookie performance downgrades wait for the verified poor-game threshold; missing statistics never create an inactivity penalty. Trajectories reset as play improves or declines, and all attribute changes keep the existing evidence requirements and five-point weekly cap. These outcomes appear in normal progression recommendations and internal tracking; no rookie recap messages are posted. Configure these expectations under `progression.developmentPipeline.rookieOutcomes`.

Players in their first three seasons gain selection priority after two qualifying games scoring at least 85. Rookies receive the strongest priority and an extra point on up to two supported attributes; two games scoring at least 90 add an elite-performance bonus to the primary supported attribute at any experience level. Existing weekly limits of five points per attribute and a maximum rating of 99 still apply. Missing or invalid experience data never identifies a player as a rookie or young player. Team-level offensive-line proxies do not receive these additional acceleration bonuses. Missing statistics never trigger inactivity downgrades; injuries and incomplete data retain their protections. Configure this behavior under `progression.developmentPipeline`.

Set `LB_DATA_ROOT` to a persistent volume (for example `/data`) when hosting. Otherwise runtime storage uses `./data`.

- `madden/leagues/`: franchise snapshots and sync history.
- `guilds/<server-id>/`: channel configuration and EA tokens.
- `leaguebuddy/madden_connections.json`: connection dashboard sessions and imports.
- `draft_classes/madden/`: draft-class reference files.

Bundled draft classes are copied to the data root on startup only when the destination file is absent. Both `bundled_data/draft_classes/` and its `madden/` subdirectory are supported. Mock drafts and big boards select CUS01 for season 1, CUS02 for season 2, CUS03 for season 3, and so on. Name subsequent files like `Madden 26 CUS03 - Big Board.json`; a missing class is reported rather than substituting a different season. Bundled classes take precedence over data-root copies, and files directly in the bundled directory take precedence over duplicates in subdirectories. Existing draft files and historical billing/runtime data are not deleted by this conversion.

Set `LB_PUBLIC_BASE_URL` to the public dashboard URL when hosted. `PORT` enables the shared HTTP listener; `/health` returns 200 while Discord is ready. The dashboard supports EA connection and JSON imports through operator-issued setup links.

Development commands use `.env.dev`; production commands use `.env.prod`. Both deploy only to `MADDEN_SOLO_GUILD_ID`. Use `npm run check:commands` to inspect the command payload without contacting Discord.

## Development

Opening the EA Madden session retries temporary service failures up to three times with a 15-second timeout per request. Optional overrides are `EA_SESSION_MAX_ATTEMPTS` (1–5), `EA_SESSION_RETRY_BASE_MS` (default 1000), and `EA_SESSION_TIMEOUT_MS` (default 15000, maximum 30000). Expired-token responses require reconnecting through `/setup`; temporary service errors preserve the saved connection and recommend retrying `/sync` later.

`npm test` runs the solo authorization, command catalog, setup, sync history, progression, report, and draft checks with isolated temporary data roots. Tests do not log into Discord, EA, or payment services.

`src/leaguebuddy/solo_mode.js` defines the shared runtime/deployment command catalog. The app fails startup when either solo ID is missing. Command import failures stop startup and deployment instead of leaving a partial catalog.

`apps/snallabot-service` is retained as a separate reference checkout and is not a workspace dependency or started by this app.
