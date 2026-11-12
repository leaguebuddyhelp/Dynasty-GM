# Solo franchise connection

`/setup` creates a private connection session restricted to the configured operator and server. Its temporary bearer token opens `/madden/connect`, where the operator can connect EA, select a franchise, or import JSON.

`src/madden/services/export_first_connection_service.js` manages connection state and imports. `src/leaguebuddy/repositories/madden_connection_repository.js` persists sessions, connection records, export sources, jobs, and snapshots under `LB_DATA_ROOT`.

`/sync` imports EA data into the Madden snapshot store, archives the sync, and publishes solo reports. No billing, activation, subscription, or feature-pack state participates in setup or access.

The shared HTTP server provides `/health` and dashboard/import routes. Runtime and command deployment use the same explicit solo catalog. Existing sessions belonging to other operators or servers are rejected.
