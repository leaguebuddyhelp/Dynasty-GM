# LEAGUEbuddy Madden Export-First Architecture

## Goal

Replace fragile EA browser OAuth as the core setup path with an export/import-first system:

- Discord is the control surface
- backend is the ingestion + sync source of truth
- league connection is based on export URLs, import jobs, and stored snapshots
- EA/browser auth remains optional and experimental only

This is modeled on the practical shape of tools like Snallabot, not on undocumented internals.

## Product Architecture

### 1. Discord Bot Layer

Responsibilities:

- guide league setup
- issue connect/sync/status commands
- show progress and errors
- map Discord guilds to backend-managed league connections
- never do heavy parsing or long-running sync work inline

Primary commands:

- `/connectleague`
- `/syncleague`
- `/league-status`
- `/disconnectleague`
- `/relinkleague`
- `/sync-history`
- `/league-debug` (staff/admin only)

### 2. API / Backend Layer

Responsibilities:

- create one-time setup tokens
- generate unique export/import endpoints
- accept export payloads or uploaded files
- validate and normalize imported franchise data
- create snapshots
- queue sync jobs
- expose league status back to Discord and dashboard

Core API shape:

- `POST /api/madden/connect/start`
- `POST /api/madden/imports/:token`
- `POST /api/madden/leagues/:leagueId/sync`
- `GET /api/madden/leagues/:leagueId/status`
- `GET /api/madden/leagues/:leagueId/imports`
- `POST /api/madden/leagues/:leagueId/relink`

### 3. Database / Storage Layer

Responsibilities:

- store guild-to-league mappings
- store import snapshots and sync runs
- store import job state
- store feature flags
- store support/debug traces

Recommended split:

- relational DB for metadata/state
- object/file storage for raw import payloads and parsed snapshots

Railway MVP:

- metadata in JSON/file-backed repository or SQLite/Postgres
- raw payloads under `/data`

### 4. Dashboard / Admin Layer

Responsibilities:

- show connection instructions
- show latest import/sync result
- show import token / upload URL
- let admins trigger syncs manually
- show errors in human-readable form

This should be optional for MVP, but the backend should be designed so it can support one cleanly later.

### 5. Import / Sync Job System

Responsibilities:

- queue import parsing and sync jobs
- run jobs idempotently
- retry transient failures
- track status transitions

Status model:

- `pending`
- `processing`
- `succeeded`
- `failed`
- `partial`
- `superseded`

## User Flow

### Connection Flow

1. Commissioner runs `/connectleague`
2. Bot creates a one-time setup token and returns:
   - an export URL
   - setup instructions
   - optionally a dashboard link
3. User performs the supported export flow and uploads/posts data to the backend
4. Backend validates the import and creates a league snapshot
5. Backend marks the league connection as `connected`
6. Bot confirms success in Discord
7. User can now run `/syncleague current`, `/league-status`, etc.

### Sync Flow

1. User runs `/syncleague current`
2. Bot enqueues a sync job
3. Backend loads latest snapshot/import source
4. Backend parses and normalizes:
   - roster
   - schedule
   - standings
   - stats
   - transactions
5. Backend writes a new sync run
6. Bot reports result

### Recommended User Experience

- Discord handles setup and control
- Dashboard handles visibility and troubleshooting
- Import endpoint handles ingestion
- No core dependency on EA callback redirects

## Commands To Build First

### `/connectleague`

Purpose:

- starts league connection
- returns unique import URL/setup token

Response should include:

- token expiration
- what file/export to upload
- next step after successful import

### `/syncleague mode:<current|week|all>`

Purpose:

- triggers a sync run

Modes:

- `current`: only current operational snapshot
- `week`: current week artifacts + stats
- `all`: full league rebuild from latest import source

### `/league-status`

Purpose:

- show connection state
- show last import
- show last successful sync
- show pending or failed jobs

### `/disconnectleague`

Purpose:

- disconnect current league mapping from this guild
- retain snapshots unless explicitly deleted

### `/relinkleague`

Purpose:

- invalidate current setup token
- issue a new one

### `/sync-history`

Purpose:

- show recent sync runs and their results

### `/league-debug`

Staff/admin only.

Purpose:

- raw diagnostics
- token state
- mapping state
- latest import parse errors

## Backend Module Breakdown

### `src/madden/services/league_connection_service.js`

Responsibilities:

- create connect session
- create setup/import token
- bind guild -> league connection
- relink/disconnect operations

### `src/madden/services/export_link_service.js`

Responsibilities:

- generate signed import URLs
- validate token expiration
- prevent duplicate or replayed setup submissions

### `src/madden/services/import_ingestion_service.js`

Responsibilities:

- accept raw upload/export payload
- validate payload shape
- store raw import artifact
- create import job

### `src/madden/services/import_parser_service.js`

Responsibilities:

- parse raw import data
- normalize into internal snapshot format
- detect franchise metadata
- detect week/season

### `src/madden/services/sync_job_service.js`

Responsibilities:

- enqueue sync work
- execute sync phases
- retry transient failures
- write sync run records

### `src/madden/services/league_mapping_service.js`

Responsibilities:

- map guild, league, platform, season, import source

### `src/madden/services/roster_sync_service.js`

Responsibilities:

- update roster tables/view models

### `src/madden/services/schedule_sync_service.js`

Responsibilities:

- update schedule, week, game status

### `src/madden/services/standings_sync_service.js`

Responsibilities:

- update standings and playoff context

### `src/madden/services/stats_sync_service.js`

Responsibilities:

- import stat leaders, player stats, team stats

### `src/madden/services/error_log_service.js`

Responsibilities:

- structured logging
- import/sync failure grouping

### `src/madden/services/admin_support_service.js`

Responsibilities:

- internal support lookups
- force reprocess
- inspect latest raw artifact

## Database Schema

### `guilds`

Fields:

- `id`
- `discord_guild_id`
- `name`
- `plan`
- `created_at`
- `updated_at`

### `leagues`

Fields:

- `id`
- `external_league_key` nullable
- `name`
- `platform`
- `game_year`
- `season_label`
- `status` (`pending`, `connected`, `inactive`)
- `created_at`
- `updated_at`

### `league_connections`

Fields:

- `id`
- `guild_id`
- `league_id`
- `connection_status` (`pending`, `connected`, `broken`, `disconnected`)
- `source_type` (`export_upload`, `export_url`, `manual_import`, `experimental_ea`)
- `last_import_job_id` nullable
- `last_sync_run_id` nullable
- `created_at`
- `updated_at`

### `connect_sessions`

Fields:

- `id`
- `guild_id`
- `setup_token`
- `status` (`open`, `used`, `expired`, `revoked`)
- `expires_at`
- `created_by_discord_user_id`
- `created_at`
- `used_at`

### `import_jobs`

Fields:

- `id`
- `league_id`
- `guild_id`
- `connect_session_id` nullable
- `job_type` (`initial_connect`, `manual_sync`, `rebuild`)
- `status` (`pending`, `processing`, `succeeded`, `failed`, `partial`)
- `raw_object_path`
- `error_code` nullable
- `error_message` nullable
- `started_at`
- `finished_at`
- `created_at`

### `import_snapshots`

Fields:

- `id`
- `league_id`
- `import_job_id`
- `snapshot_type` (`full`, `current_week`, `stats_only`)
- `season_year`
- `week_label`
- `is_current`
- `summary_json`
- `parsed_object_path`
- `created_at`

### `sync_runs`

Fields:

- `id`
- `league_id`
- `guild_id`
- `trigger_type` (`command`, `auto`, `admin`)
- `mode` (`current`, `week`, `all`)
- `status` (`pending`, `processing`, `succeeded`, `failed`, `partial`)
- `source_snapshot_id`
- `error_message` nullable
- `started_at`
- `finished_at`
- `created_at`

### `export_tokens`

Fields:

- `id`
- `league_id` nullable
- `guild_id`
- `token`
- `purpose` (`connect`, `relink`, `upload`)
- `status` (`active`, `used`, `expired`, `revoked`)
- `expires_at`
- `created_at`

### `error_logs`

Fields:

- `id`
- `scope` (`import`, `sync`, `command`, `api`)
- `guild_id` nullable
- `league_id` nullable
- `job_id` nullable
- `code`
- `message`
- `details_json`
- `created_at`

### `feature_flags`

Fields:

- `id`
- `flag_key`
- `guild_id` nullable
- `enabled`
- `config_json`
- `created_at`
- `updated_at`

Use `experimental_ea_auth` as a feature flag later, not as the main path.

## Implementation Order

### Phase 1: MVP Connection

Build only:

- `/connectleague`
- import token generation
- one ingestion route
- one parser
- one snapshot record
- `/league-status`

Success criteria:

- guild can connect one league
- one import stored
- one snapshot created
- status visible in Discord

### Phase 2: Manual Sync

Build:

- `/syncleague current`
- `/syncleague all`
- sync run records
- retry-safe sync job executor

Success criteria:

- manual syncs are dependable
- status shows success/failure cleanly

### Phase 3: Dashboard Visibility

Build:

- basic web dashboard
- league detail page
- import history
- sync history
- connection troubleshooting

### Phase 4: Automation

Build:

- recurring sync scheduler
- stale league alerts
- failed import retry UI

### Phase 5: Experimental Extras

Build behind flags only:

- EA/browser auth
- local sidecar
- advanced token capture

These should not block the core product.

## File / Folder Structure

```text
src/
  app.js
  config/
    env.js
    feature_flags.js
  db/
    index.js
    migrations/
    repositories/
      guild_repository.js
      league_repository.js
      league_connection_repository.js
      connect_session_repository.js
      import_job_repository.js
      import_snapshot_repository.js
      sync_run_repository.js
      export_token_repository.js
      error_log_repository.js
  api/
    routes/
      madden_connect_routes.js
      madden_import_routes.js
      madden_sync_routes.js
      madden_status_routes.js
    controllers/
      madden_connect_controller.js
      madden_import_controller.js
      madden_sync_controller.js
      madden_status_controller.js
  jobs/
    queue.js
    import_job_runner.js
    sync_job_runner.js
  madden/
    commands/
      connectleague.js
      syncleague.js
      league_status.js
      disconnectleague.js
      relinkleague.js
      sync_history.js
      league_debug.js
    services/
      league_connection_service.js
      export_link_service.js
      import_ingestion_service.js
      import_parser_service.js
      sync_job_service.js
      league_mapping_service.js
      roster_sync_service.js
      schedule_sync_service.js
      standings_sync_service.js
      stats_sync_service.js
      error_log_service.js
      admin_support_service.js
    parsers/
      franchise_parser.js
      roster_parser.js
      stats_parser.js
      standings_parser.js
      schedule_parser.js
    providers/
      export_provider.js
      experimental_ea_provider.js
  leaguebuddy/
    setup_status_service.js
    manual_billing_service.js
  shared/
    logger.js
    ids.js
    time.js
```

## MVP To Build First

The smallest version that proves the architecture:

1. `/connectleague`
   - creates `connect_session`
   - returns one upload/import URL

2. `POST /api/madden/imports/:token`
   - accepts one export payload or file
   - stores raw artifact under `/data`
   - creates one `import_job`

3. `import_parser_service`
   - extracts league metadata, current week, basic teams
   - writes one `import_snapshot`

4. `league_connection_service`
   - marks league connected to guild

5. `/league-status`
   - shows:
     - connected/not connected
     - last import time
     - last snapshot summary

Ignore for MVP:

- auto sync
- dashboard polish
- full stats import
- EA/browser auth
- advanced retries

## Recommended Routes

- `POST /api/madden/connect/start`
- `POST /api/madden/imports/:setupToken`
- `GET /api/madden/leagues/:leagueId/status`
- `POST /api/madden/leagues/:leagueId/sync`
- `POST /api/madden/leagues/:leagueId/disconnect`

## Recommended First Commands

- `/connectleague`
- `/league-status`
- `/syncleague current`
- `/syncleague all`
- `/disconnectleague`

## Error Handling Rules

- never parse heavy imports inside the Discord interaction
- every import creates a job record
- every sync creates a sync run
- every failure writes a user-safe summary and a detailed internal error log
- duplicate connect token use should be rejected cleanly
- replayed uploads should mark old tokens as used/revoked

## What To Ignore For Now

- complex live OAuth/browser auth
- per-user auth accounts
- fancy dashboard onboarding
- automatic week detection perfection
- deep automation before import/sync is solid

## Honest Unknowns

Snallabot internals are not fully public. The architecture above is an inference from:

- export/import-first product behavior
- loopback/manual auth patterns
- Discord as control surface
- backend-managed state and sync

The goal here is not to clone hidden internals. It is to reproduce the reliable system shape:

- connection does not depend on fragile browser callback hosting
- sync is driven by import artifacts and backend jobs
- Discord stays simple and dependable
