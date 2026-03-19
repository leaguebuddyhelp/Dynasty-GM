# LEAGUEbuddy

This repo contains multiple feature areas, but the **v2 setup flow is Madden-only**.

Repo layout (high level):
- `src/madden/**` — Madden bot features + the v2 per-guild setup overlay.
- `src/2k/**` — legacy 2K utilities (not part of the v2 sellable setup flow).
- `apps/snallabot-service` — Snallabot source (for Madden features/reference).

Node version: `.nvmrc` set to 21 to satisfy Snallabot; use `nvm use`.

## Madden EA sync (Snallabot-style)
- Commands: `/madden-sync league_id:<id>` pulls from EA and saves to `src/data/madden/leagues/<id>.json`. `/madden-ping` checks the module.
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
- Admin billing commands:
  - `/activateplan`
  - `/deactivateplan`
  - `/attachpaymentref`
  - `/viewbilling`
- Stripe links are configured with:
  - `LB_UPGRADE_URL_STANDARD`
  - `LB_UPGRADE_URL_PREMIUM`
  - optional fallback: `LB_UPGRADE_URL`
- Current sales flow is manual by design:
  1. Customer runs `/pricing`
  2. Customer pays through the Stripe link
  3. Customer provides the Discord server id if needed
  4. Admin runs `/activateplan`
  5. Customer runs `/plan` and `/madden-setup-check`
- No Stripe webhook automation is implemented in this flow.

## Self-hosting checklist
1. Configure `DISCORD_TOKEN` and the Discord app ids in your env file.
2. Configure `LB_UPGRADE_URL_STANDARD` and `LB_UPGRADE_URL_PREMIUM` if you want live customer upgrade links.
3. Start the bot and run `/madden-set-league` in the target server.
4. Run `/setup` to create the Madden overlay config and channel/role mappings.
5. Run `/plan` to verify customer-facing access state.
6. Run `/madden-setup-check` to verify setup completion.
7. Run `/operator-check` as an admin to confirm env, league mapping, setup, and billing status.

## Railway notes
- Set env vars in Railway instead of relying on local `.env` files.
- Mount a persistent volume for runtime data.
- Set `LB_DATA_ROOT` to the mounted path, for example `/data`.
- When `LB_DATA_ROOT` is unset, the bot keeps using the local `./data` directory.
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
