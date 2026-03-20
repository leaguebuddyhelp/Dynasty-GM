# LEAGUEbuddy

This repo contains multiple feature areas, but the **v2 setup flow is Madden-only**.

Repo layout (high level):
- `src/madden/**` — Madden bot features + the v2 per-guild setup overlay.
- `src/2k/**` — legacy 2K utilities (not part of the v2 sellable setup flow).
- `apps/snallabot-service` — Snallabot source (for Madden features/reference).

Node version: `.nvmrc` set to 21 to satisfy Snallabot; use `nvm use`.

## Madden EA sync (Snallabot-style)
- Commands: `/sync league_id:<id>` pulls from EA and saves to `data/madden/leagues/<id>.json`, or under `LB_DATA_ROOT` when that env var is set. `/ping` checks the module.
- Env required: `EA_ACCESS_TOKEN`, `EA_REFRESH_TOKEN`, optional `EA_ACCESS_TOKEN_EXPIRES_AT` (ms epoch), `EA_CONSOLE` (ps5/xbsx/xone/pc/ps4/stadia), `EA_BLAZE_ID` (persona id if known). Tokens expire ~4h; refresh token ~10 days.

## 2K note
The repo still contains 2K code under `src/2k/**`, but **2K is not a buyable v2 option** and is not wired into the Madden v2 setup commands.

## Working on Snallabot
```
cd apps/snallabot-service
npm install
npm run dev
```

## Notes
- Root `node_modules` is from the old layout; reinstall per app as needed.
- Env files stay where you prefer; place per-app `.env` files inside each app for clarity.

## LEAGUEbuddy pricing / manual activation
- Customer-facing commands:
  - `/pricing` shows Free, Standard, and Premium plus Stripe checkout buttons when configured.
  - `/plan` shows current plan, setup state, packs enabled, blocked features, and next steps.
  - `/claim-plan` lets a server manager claim a paid plan after Stripe checkout.
- Admin billing commands:
  - `/activateplan`
  - `/deactivateplan`
  - `/attachpaymentref`
  - `/viewbilling`
- Stripe links are configured with:
  - `LB_UPGRADE_URL_STANDARD`
  - `LB_UPGRADE_URL_PREMIUM`
  - optional fallback: `LB_UPGRADE_URL`
- Bot invite is configured with:
  - `LB_BOT_INVITE_URL`
  - or falls back to `CLIENT_ID`
- Current sales flow is manual by design:
  1. Customer invites LEAGUEbuddy to the target server
  2. Customer runs `/start-here`
  3. If they still need plan info, they run `/pricing`
  4. Customer pays through the Stripe link
  5. Customer runs `/claim-plan`
  6. Customer runs `/plan` and `/setup-check`
- No Stripe webhook automation is implemented in this flow.

## Optional Stripe claim webhook
- For a self-serve claim flow, enable:
  - `LB_STRIPE_CLAIMS_WEBHOOK_ENABLED=true`
  - `LB_STRIPE_WEBHOOK_SECRET`
- Stripe webhook endpoint:
  - `POST /stripe/webhook`
- Plan inference is supported from:
  - `session.metadata.lb_plan` or `session.metadata.plan`
  - `client_reference_id` like `lb_plan:standard`
  - `LB_STRIPE_PAYMENT_LINK_ID_STANDARD`
  - `LB_STRIPE_PAYMENT_LINK_ID_PREMIUM`
  - optional amount fallbacks:
    - `LB_STRIPE_STANDARD_AMOUNT_CENTS`
    - `LB_STRIPE_PREMIUM_AMOUNT_CENTS`
- The webhook creates a one-time claim record. Customers can claim with:
  - a generated claim code
  - or the Stripe payment reference from their receipt

## Self-hosting checklist
1. Configure `DISCORD_TOKEN` and the Discord app ids in your env file.
2. Configure `LB_UPGRADE_URL_STANDARD` and `LB_UPGRADE_URL_PREMIUM` if you want live customer upgrade links.
3. Run `/connectleague` in the target server and finish the dashboard flow.
4. Run `/sync` so LEAGUEbuddy stores the first live snapshot.
5. Run `/setup-channels` to create the Madden overlay config, category, channels, and the first pin pass.
6. If that reply says some pins missed, run `/setup-pins` to retry only the pins.
7. Run `/setup-roles` to create the staff, trade, and coach roles.
8. Run `/plan` to verify customer-facing access state.
9. Run `/setup-check` to verify setup completion.
10. Run `/server-check` as an admin to confirm the server is ready.
11. Run `/create-threads` when you are ready to open the current week or playoff matchup threads.

## Start Here
- The clean commissioner flow inside Discord is:
  1. Invite the bot
  2. `/start-here`
  3. If needed: `/pricing`
  4. `/activateplan`
  5. `/connectleague`
  6. Finish the dashboard flow
  7. `/sync`
  8. `/setup-channels`
  9. If pins missed: `/setup-pins`
  10. `/setup-roles`
  11. `/syncsetupstatus`
  12. `/server-check`
  13. `/create-threads`
- The admin summary command for this flow is:
  - `/start-here`

## Command deploy model
- Development uses guild command deploys so updates appear quickly in your test servers.
- Production should use global command deploys so customers can invite the bot and use commands without you doing anything per server.
- The intended split is:
  - Dev bot: `npm run deploy:dev`
  - Prod bot: `npm run deploy:prod`
- `deploy:dev` can now target multiple test servers with `GUILD_IDS=id1,id2,...` in `.env.dev`.
- `deploy:prod` registers global commands for the production application, which is the self-serve customer path.

## Railway notes
- Set env vars in Railway instead of relying on local `.env` files.
- Mount a persistent volume for runtime data.
- Set `LB_DATA_ROOT` to the mounted path, for example `/data`.
- When `LB_DATA_ROOT` is unset, the bot keeps using the local `./data` directory.
- Hosted-safe defaults now keep local helper services off unless explicitly enabled:
  - `MADDEN_AUTH_ENABLED=false`
  - `MADDEN_EXPORT_WEBHOOK_ENABLED=false`
  - `MADDEN_AUTO_SYNC_ENABLED=false`
  - `SNALLA_SIDECAR_AUTOSTART=false`
- Keep using the current manual Stripe-link env vars:
  - `LB_UPGRADE_URL_STANDARD`
  - `LB_UPGRADE_URL_PREMIUM`
- Optional healthcheck support is available:
  - set `LB_HEALTHCHECK_ENABLED=true`
  - or rely on Railway `PORT`
  - `/health` returns `200` after the Discord client is ready
- Startup logs now report:
  - active data root
  - whether Stripe upgrade URLs are configured
  - whether key storage paths are writable
  - without exposing secrets
