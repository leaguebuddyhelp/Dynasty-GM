import { registerHttpRoute, startHealthcheckServer } from '../leaguebuddy/healthcheck.js';
import connectionService from './services/export_first_connection_service.js';

function html(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LEAGUEbuddy Connect</title></head><body style="font-family:sans-serif;max-width:760px;margin:40px auto;padding:0 16px;">${body}</body></html>`;
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

function selected(value, expected) {
  return value === expected ? ' selected' : '';
}

function noticeBanner(notice) {
  if (!notice) return '';
  return `<div style="background:#ecfdf5;border:1px solid #10b981;color:#065f46;padding:12px 16px;border-radius:10px;margin:16px 0;"><strong>${escapeHtml(notice)}</strong></div>`;
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
          <td style="padding:8px;border-top:1px solid #e5e7eb;">${escapeHtml(source.label)}</td>
          <td style="padding:8px;border-top:1px solid #e5e7eb;"><code>${escapeHtml(source.exportUrl)}</code></td>
          <td style="padding:8px;border-top:1px solid #e5e7eb;">${source.autoUpdate ? 'On' : 'Manual'}</td>
        </tr>
      `).join('')
    : `<tr><td colspan="3" style="padding:8px;border-top:1px solid #e5e7eb;color:#6b7280;">No export sources added yet.</td></tr>`;

  return html(`
    <h1>LEAGUEbuddy League Setup</h1>
    <p>This setup page mirrors the real product flow more closely: create the league record here, add export sources here, then return to Discord to finish setup.</p>
    ${noticeBanner(notice)}
    <section style="border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin:20px 0;">
      <h2 style="margin-top:0;">League Record</h2>
      <p style="color:#4b5563;">This ties your Discord server to one backend league record.</p>
      <form method="POST" action="/madden/connect/league?token=${encodeURIComponent(token)}">
        <label for="league_name"><strong>League Name</strong></label><br />
        <input id="league_name" name="league_name" value="${escapeHtml(leagueName)}" style="width:100%;margin:8px 0 16px;padding:10px;" placeholder="GHOST LEGACY" required />
        <label for="league_external_id"><strong>League ID</strong> <span style="color:#6b7280;">(optional)</span></label><br />
        <input id="league_external_id" name="league_external_id" value="${escapeHtml(leagueExternalId)}" style="width:100%;margin:8px 0 16px;padding:10px;" placeholder="ea-league-id" />
        <button type="submit">Save League Record</button>
      </form>
    </section>

    <section style="border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin:20px 0;">
      <h2 style="margin-top:0;">Export Sources</h2>
      <p style="color:#4b5563;">Add one or more export URLs that LEAGUEbuddy should treat as the source of truth for this league.</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        <thead>
          <tr style="text-align:left;">
            <th style="padding:8px 8px 8px 0;">Label</th>
            <th style="padding:8px;">Export URL</th>
            <th style="padding:8px;">Mode</th>
          </tr>
        </thead>
        <tbody>${exportRows}</tbody>
      </table>
      <form method="POST" action="/madden/connect/export-source?token=${encodeURIComponent(token)}">
        <label for="label"><strong>Source Label</strong></label><br />
        <input id="label" name="label" style="width:100%;margin:8px 0 16px;padding:10px;" placeholder="Primary Export Source" />
        <label for="export_url"><strong>Export URL</strong></label><br />
        <input id="export_url" name="export_url" style="width:100%;margin:8px 0 16px;padding:10px;" placeholder="http://127.0.0.1:PORT/..." required />
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin:8px 0 16px;">
          <label><input type="checkbox" name="league_info" value="1" checked /> League Info</label>
          <label><input type="checkbox" name="weekly_stats" value="1" checked /> Weekly Stats</label>
          <label><input type="checkbox" name="roster" value="1" checked /> Roster</label>
          <label><input type="checkbox" name="extra_data" value="1" /> Extra Data</label>
          <label><input type="checkbox" name="auto_update" value="1" checked /> Auto Update</label>
        </div>
        <button type="submit"${connection ? '' : ' disabled'}>Add Export Source</button>
        ${connection ? '' : '<p style="color:#b45309;margin-top:12px;">Save the league record first.</p>'}
      </form>
    </section>

    <section style="border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin:20px 0;">
      <h2 style="margin-top:0;">Current Status</h2>
      <ul>
        <li><strong>Status:</strong> ${escapeHtml(status)}</li>
        <li><strong>Export Sources:</strong> ${escapeHtml(exportSources.length)}</li>
        <li><strong>Last Snapshot:</strong> ${escapeHtml(snapshot?.id || 'none yet')}</li>
        <li><strong>Current Week:</strong> ${escapeHtml(snapshot?.summary?.week || connection?.summary?.week || 'unknown')}</li>
      </ul>
      <p>After this page looks right, return to Discord and run <code>/league-status</code>.</p>
    </section>

    <details style="margin:24px 0;">
      <summary><strong>Fallback: manual JSON import</strong></summary>
      <p style="color:#4b5563;">This is still available as a debug/import fallback, but it is no longer the primary customer path.</p>
      <form method="POST" action="/madden/import?token=${encodeURIComponent(token)}">
        <textarea id="payload" name="payload" rows="12" style="width:100%;margin-top:8px;" placeholder='{"leagueName":"My League","leagueId":"abc123"}'></textarea>
        <div style="margin-top:16px;">
          <button type="submit">Import Snapshot</button>
        </div>
      </form>
    </details>
  `);
}

export function startConnectServer() {
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
