import fs from 'fs';
import path from 'path';

import { registerHttpRoute, startHealthcheckServer } from '../leaguebuddy/healthcheck.js';
import connectionService from './services/export_first_connection_service.js';

function html(body) {
  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>LEAGUEbuddy Connect</title>
      <style>
        :root {
          --lb-bg: #111111;
          --lb-panel: #171717;
          --lb-panel-soft: #222222;
          --lb-surface: #ffffff;
          --lb-surface-soft: #fffdf4;
          --lb-border: #e7d78c;
          --lb-text: #141414;
          --lb-muted: #5b5340;
          --lb-accent: #ffe15a;
          --lb-accent-strong: #ffcc00;
          --lb-accent-ink: #1f1b08;
          --lb-success-bg: #ecfdf5;
          --lb-success-border: #10b981;
          --lb-success-text: #065f46;
          --lb-warning-bg: #fff7ed;
          --lb-warning-text: #9a3412;
          --lb-shadow: 0 24px 60px rgba(20, 20, 20, 0.16);
        }

        * { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: "Avenir Next", Avenir, "Trebuchet MS", "Segoe UI", sans-serif;
          background:
            radial-gradient(circle at top left, rgba(255, 225, 90, 0.28), transparent 22%),
            linear-gradient(180deg, #fff7bf 0%, #fffdf5 38%, #f7f3df 100%);
          color: var(--lb-text);
        }
        .shell {
          max-width: 1080px;
          margin: 0 auto;
          padding: 28px 16px 56px;
        }
        .hero {
          background:
            radial-gradient(circle at top right, rgba(255, 225, 90, 0.18), transparent 28%),
            linear-gradient(135deg, #0d0d0d 0%, #171717 50%, #202020 100%);
          color: #f8fafc;
          border-radius: 24px;
          padding: 28px;
          box-shadow: var(--lb-shadow);
          display: grid;
          grid-template-columns: 96px 1fr;
          gap: 20px;
          align-items: center;
        }
        .hero img {
          width: 96px;
          height: 96px;
          object-fit: contain;
          border-radius: 22px;
          background: #ffe162;
          padding: 0;
          box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.12);
        }
        .eyebrow {
          display: inline-block;
          color: var(--lb-accent);
          font-size: 12px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 1.4px;
          margin-bottom: 8px;
        }
        h1 {
          margin: 0 0 8px;
          font-size: clamp(2rem, 5vw, 3.4rem);
          line-height: 0.98;
        }
        .hero p {
          margin: 0;
          max-width: 680px;
          color: #efe6b7;
          font-size: 1rem;
          line-height: 1.55;
        }
        .layout {
          display: grid;
          grid-template-columns: minmax(0, 1.7fr) minmax(280px, 0.9fr);
          gap: 18px;
          margin-top: 20px;
        }
        .panel {
          background: rgba(255, 255, 255, 0.94);
          border: 1px solid rgba(231, 215, 140, 0.92);
          border-radius: 22px;
          padding: 22px;
          box-shadow: 0 18px 48px rgba(20, 20, 20, 0.08);
        }
        .panel h2 {
          margin: 0 0 10px;
          font-size: 1.35rem;
        }
        .panel p,
        .panel li,
        .panel td,
        .panel th,
        .panel label {
          line-height: 1.5;
        }
        .notice {
          background: var(--lb-success-bg);
          border: 1px solid var(--lb-success-border);
          color: var(--lb-success-text);
          padding: 12px 16px;
          border-radius: 14px;
          margin: 0 0 18px;
        }
        .warning {
          background: var(--lb-warning-bg);
          color: var(--lb-warning-text);
          border-radius: 14px;
          padding: 12px 14px;
          margin-top: 12px;
        }
        .subtle {
          background: rgba(255, 225, 90, 0.16);
          color: #6b5200;
          border-radius: 14px;
          padding: 12px 14px;
          margin-top: 12px;
        }
        .meta-card {
          background: linear-gradient(180deg, #fff6c5 0%, #fffdf4 100%);
          border: 1px solid var(--lb-border);
          border-radius: 18px;
          padding: 18px;
        }
        .stat-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-top: 16px;
        }
        .stat {
          background: var(--lb-panel-soft);
          color: #f8fafc;
          border-radius: 16px;
          padding: 14px;
        }
        .stat strong {
          display: block;
          color: var(--lb-accent);
          font-size: 0.78rem;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          margin-bottom: 6px;
        }
        .stat span {
          font-size: 1.1rem;
          font-weight: 700;
        }
        form {
          margin: 0;
        }
        input,
        textarea,
        select {
          width: 100%;
          margin: 8px 0 16px;
          padding: 12px 14px;
          border-radius: 14px;
          border: 1px solid #dccd87;
          background: #fffef8;
          color: var(--lb-text);
          font: inherit;
        }
        input:focus,
        textarea:focus,
        select:focus {
          outline: 2px solid rgba(255, 204, 0, 0.45);
          border-color: #d9b200;
        }
        textarea {
          min-height: 220px;
          resize: vertical;
        }
        button {
          border: 0;
          border-radius: 14px;
          padding: 12px 16px;
          background: linear-gradient(180deg, var(--lb-accent) 0%, var(--lb-accent-strong) 100%);
          color: var(--lb-accent-ink);
          font: inherit;
          font-weight: 800;
          cursor: pointer;
          box-shadow: 0 10px 26px rgba(255, 204, 0, 0.18);
        }
        button[disabled] {
          background: #cbd5e1;
          color: #64748b;
          cursor: not-allowed;
        }
        code {
          font-family: "SFMono-Regular", Menlo, monospace;
          font-size: 0.92em;
          word-break: break-all;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 18px;
        }
        th {
          text-align: left;
          color: var(--lb-muted);
          font-size: 0.82rem;
          text-transform: uppercase;
          letter-spacing: 0.6px;
        }
        td, th {
          padding: 10px 8px 10px 0;
          border-top: 1px solid #e5e7eb;
          vertical-align: top;
        }
        td:last-child, th:last-child {
          padding-right: 0;
        }
        .pill {
          display: inline-block;
          padding: 6px 10px;
          border-radius: 999px;
          background: rgba(255, 204, 0, 0.18);
          color: #6b5200;
          font-weight: 700;
          font-size: 0.85rem;
        }
        .check-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
          gap: 8px;
          margin: 8px 0 16px;
        }
        .check-grid label {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid #e6d78a;
          background: #fffdf4;
        }
        details {
          margin-top: 18px;
        }
        summary {
          cursor: pointer;
          font-weight: 700;
        }
        .stack {
          display: grid;
          gap: 18px;
        }
        @media (max-width: 860px) {
          .layout {
            grid-template-columns: 1fr;
          }
          .hero {
            grid-template-columns: 1fr;
          }
          .hero img {
            width: 72px;
            height: 72px;
          }
        }
      </style>
    </head>
    <body>
      <div class="shell">${body}</div>
    </body>
  </html>`;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function parseToken(req) {
  return new URL(String(req.url || '/'), 'http://127.0.0.1').searchParams.get('token') || '';
}

function parseNotice(req) {
  return new URL(String(req.url || '/'), 'http://127.0.0.1').searchParams.get('notice') || '';
}

function parsePayload(raw, contentType) {
  if (String(contentType || '').includes('application/json')) {
    return raw;
  }
  const form = new URLSearchParams(raw);
  return form.get('payload') || '';
}

function parseForm(raw) {
  return new URLSearchParams(raw);
}

function checked(value) {
  return value ? ' checked' : '';
}

function noticeBanner(notice) {
  if (!notice) return '';
  return `<div class="notice"><strong>${escapeHtml(notice)}</strong></div>`;
}

function renderDashboard({ token, dashboard, notice = '' }) {
  const connection = dashboard.connection;
  const exportSources = dashboard.exportSources || [];
  const snapshot = dashboard.latestSnapshot;
  const leagueName = connection?.leagueName || '';
  const leagueExternalId = connection?.leagueExternalId || '';
  const status = connection?.status || 'not_connected';

  const exportRows = exportSources.length
    ? exportSources.map((source) => `
        <tr>
          <td>${escapeHtml(source.label)}</td>
          <td><code>${escapeHtml(source.exportUrl)}</code></td>
          <td>${source.autoUpdate ? '<span class="pill">Auto</span>' : 'Manual'}</td>
        </tr>
      `).join('')
    : `<tr><td colspan="3" style="color:#6b7280;">No export sources added yet.</td></tr>`;

  return html(`
    <section class="hero">
      <img src="/madden/assets/lb-official-logo.png" alt="LEAGUEbuddy logo" />
      <div>
        <span class="eyebrow">LEAGUEbuddy Madden</span>
        <h1>League Dashboard Setup</h1>
        <p>Set up your league here first, then finish the rest in Discord. This keeps league connection stable and gives your server one clear source for syncs and updates.</p>
      </div>
    </section>
    <div class="layout">
      <div class="stack">
        <section class="panel">
          ${noticeBanner(notice)}
          <h2>Step 1: Name Your League</h2>
          <p style="color:#4b5563;">Start by naming the league you want this Discord server to use.</p>
          <form method="POST" action="/madden/connect/demo?token=${encodeURIComponent(token)}" style="margin-bottom:16px;">
            <button type="submit">Load Demo League</button>
          </form>
          <div class="subtle">Just testing? This fills the dashboard with a sample league, sample export link, and a snapshot so you can click around right now.</div>
          <form method="POST" action="/madden/connect/league?token=${encodeURIComponent(token)}">
            <label for="league_name"><strong>League Name</strong></label><br />
            <input id="league_name" name="league_name" value="${escapeHtml(leagueName)}" placeholder="Ghost Legacy" required />
            <label for="league_external_id"><strong>League ID</strong> <span style="color:#6b7280;">(optional)</span></label><br />
            <input id="league_external_id" name="league_external_id" value="${escapeHtml(leagueExternalId)}" placeholder="Use this only if you already know the league ID" />
            <button type="submit">Save League Name</button>
          </form>
        </section>

        <section class="panel">
          <h2>Step 2: Add Export Link</h2>
          <p style="color:#4b5563;">Add the export link LEAGUEbuddy should use to pull league data for this server.</p>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Export Link</th>
                <th>Mode</th>
              </tr>
            </thead>
            <tbody>${exportRows}</tbody>
          </table>
          <form method="POST" action="/madden/connect/export-source?token=${encodeURIComponent(token)}">
            <label for="label"><strong>Export Name</strong></label><br />
            <input id="label" name="label" placeholder="Primary Export" />
            <label for="export_url"><strong>Export Link</strong></label><br />
            <input id="export_url" name="export_url" placeholder="http://127.0.0.1:PORT/..." required />
            <div class="check-grid">
              <label><input type="checkbox" name="league_info" value="1"${checked(true)} /> League Info</label>
              <label><input type="checkbox" name="weekly_stats" value="1"${checked(true)} /> Weekly Stats</label>
              <label><input type="checkbox" name="roster" value="1"${checked(true)} /> Rosters</label>
              <label><input type="checkbox" name="extra_data" value="1"${checked(false)} /> Extra Data</label>
              <label><input type="checkbox" name="auto_update" value="1"${checked(true)} /> Keep Updated</label>
            </div>
            <button type="submit"${connection ? '' : ' disabled'}>Add Export Source</button>
            ${connection ? '' : '<p class="warning">Save the league name first.</p>'}
          </form>
        </section>

        <section class="panel">
          <h2>Fallback Import</h2>
          <p style="color:#4b5563;">Only use this if support tells you to. This is a backup import path while the guided setup keeps improving.</p>
          <details>
            <summary>Open fallback JSON importer</summary>
            <form method="POST" action="/madden/import?token=${encodeURIComponent(token)}" style="margin-top:16px;">
              <textarea id="payload" name="payload" placeholder='{"leagueName":"My League","leagueId":"abc123"}'></textarea>
              <button type="submit">Import Snapshot</button>
            </form>
          </details>
        </section>
      </div>

      <div class="stack">
        <section class="panel meta-card">
          <span class="eyebrow" style="color:#b58900;">Live Status</span>
          <h2 style="margin-top:4px;">Current Connection</h2>
          <div class="stat-grid">
            <div class="stat">
              <strong>Status</strong>
              <span>${escapeHtml(status)}</span>
            </div>
            <div class="stat">
              <strong>Export Sources</strong>
              <span>${escapeHtml(exportSources.length)}</span>
            </div>
            <div class="stat">
              <strong>Last Snapshot</strong>
              <span>${escapeHtml(snapshot?.id || 'none')}</span>
            </div>
            <div class="stat">
              <strong>Current Week</strong>
              <span>${escapeHtml(snapshot?.summary?.week || connection?.summary?.week || 'unknown')}</span>
            </div>
          </div>
          <p style="margin:16px 0 0;color:#475569;">When this looks right, go back to Discord and run <code>/league-status</code>.</p>
        </section>

        <section class="panel">
          <span class="eyebrow" style="color:#b58900;">Setup Flow</span>
          <h2 style="margin-top:4px;">What to do next</h2>
          <ol style="padding-left:20px;margin:0;">
            <li>Save your league name.</li>
            <li>Add at least one export link.</li>
            <li>Go back to Discord and run <code>/league-status</code>.</li>
            <li>Then continue your normal setup flow there.</li>
          </ol>
        </section>
      </div>
    </div>
  `);
}

export function startConnectServer() {
  registerHttpRoute({
    method: 'GET',
    path: '/madden/assets/lb-official-logo.png',
    handler: async (_req, res) => {
      const filePath = path.join(process.cwd(), 'nfl_logos', 'lb logo', 'LB_Offical_Logo.PNG');
      try {
        const file = fs.readFileSync(filePath);
        res.writeHead(200, {
          'content-type': 'image/png',
          'cache-control': 'public, max-age=3600',
        });
        res.end(file);
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('missing asset');
      }
    },
  });

  registerHttpRoute({
    method: 'GET',
    path: '/madden/connect',
    handler: async (req, res) => {
      const token = parseToken(req);
      const notice = parseNotice(req);
      const dashboard = connectionService.getLeagueConnectionDashboard(token);
      if (!dashboard.ok) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html(`<h1>Setup Link Unavailable</h1><p>${escapeHtml(dashboard.message)}</p>`));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(renderDashboard({ token, dashboard, notice }));
    },
  });

  registerHttpRoute({
    method: 'POST',
    path: '/madden/connect/league',
    handler: async (req, res) => {
      const token = parseToken(req);
      const form = parseForm(await readBody(req));
      const result = connectionService.saveLeagueConnectionSetup({
        token,
        leagueName: form.get('league_name'),
        leagueExternalId: form.get('league_external_id'),
      });
      const location = result.ok
        ? `/madden/connect?token=${encodeURIComponent(token)}&notice=${encodeURIComponent('League record saved.')}`
        : `/madden/connect?token=${encodeURIComponent(token)}&notice=${encodeURIComponent(result.message)}`;
      res.writeHead(302, { location });
      res.end();
    },
  });

  registerHttpRoute({
    method: 'POST',
    path: '/madden/connect/demo',
    handler: async (req, res) => {
      const token = parseToken(req);
      const result = connectionService.loadDemoLeague(token);
      const location = result.ok
        ? `/madden/connect?token=${encodeURIComponent(token)}&notice=${encodeURIComponent('Demo league loaded. You can now test the dashboard and run /league-status in Discord.')}`
        : `/madden/connect?token=${encodeURIComponent(token)}&notice=${encodeURIComponent(result.message)}`;
      res.writeHead(302, { location });
      res.end();
    },
  });

  registerHttpRoute({
    method: 'POST',
    path: '/madden/connect/export-source',
    handler: async (req, res) => {
      const token = parseToken(req);
      const form = parseForm(await readBody(req));
      const result = connectionService.addLeagueExportSource({
        token,
        label: form.get('label'),
        exportUrl: form.get('export_url'),
        leagueInfo: Boolean(form.get('league_info')),
        weeklyStats: Boolean(form.get('weekly_stats')),
        roster: Boolean(form.get('roster')),
        extraData: Boolean(form.get('extra_data')),
        autoUpdate: Boolean(form.get('auto_update')),
      });
      const location = result.ok
        ? `/madden/connect?token=${encodeURIComponent(token)}&notice=${encodeURIComponent('Export source added.')}`
        : `/madden/connect?token=${encodeURIComponent(token)}&notice=${encodeURIComponent(result.message)}`;
      res.writeHead(302, { location });
      res.end();
    },
  });

  registerHttpRoute({
    method: 'POST',
    path: '/madden/import',
    handler: async (req, res) => {
      const token = parseToken(req);
      const raw = await readBody(req);
      const parsed = connectionService.ingestImportedPayload({
        token,
        rawPayload: parsePayload(raw, req.headers['content-type']),
      });
      if (!parsed.ok) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html(`<h1>Import Failed</h1><p>${escapeHtml(parsed.message)}</p>`));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html(`
        <h1>League Connected</h1>
        <p><strong>${escapeHtml(parsed.summary.leagueName)}</strong> is now connected.</p>
        <ul>
          <li>Week: ${escapeHtml(parsed.summary.week || 'unknown')}</li>
          <li>Teams: ${escapeHtml(parsed.summary.teams || 0)}</li>
          <li>Snapshot: ${escapeHtml(parsed.snapshot.id)}</li>
        </ul>
        <p>Return to Discord and run <code>/league-status</code>.</p>
      `));
    },
  });

  startHealthcheckServer();
  console.log('[madden-connect] Registered export-first connect routes');
}

export default {
  startConnectServer,
};
