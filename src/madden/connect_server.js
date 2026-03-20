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

function parsePayload(raw, contentType) {
  if (String(contentType || '').includes('application/json')) {
    return raw;
  }
  const form = new URLSearchParams(raw);
  return form.get('payload') || '';
}

export function startConnectServer() {
  registerHttpRoute({
    method: 'GET',
    path: '/madden/connect',
    handler: async (req, res) => {
      const token = parseToken(req);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html(`
        <h1>Connect LEAGUEbuddy to Your League</h1>
        <p>This is the export/import-first setup flow.</p>
        <ol>
          <li>Export your league data using the supported workflow.</li>
          <li>Paste the JSON payload below.</li>
          <li>Submit once to connect this Discord server.</li>
        </ol>
        <form method="POST" action="/madden/import?token=${encodeURIComponent(token)}">
          <label for="payload"><strong>League export JSON</strong></label><br />
          <textarea id="payload" name="payload" rows="16" style="width:100%;margin-top:8px;" placeholder='{"leagueName":"My League","leagueId":"abc123"}'></textarea>
          <div style="margin-top:16px;">
            <button type="submit">Connect League</button>
          </div>
        </form>
      `));
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
