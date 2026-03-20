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
        .info {
          background: #fff8dc;
          color: #5b4300;
          border: 1px solid #ecd56b;
          border-radius: 16px;
          padding: 14px 16px;
          margin: 0 0 18px;
        }
        .timeline {
          display: grid;
          gap: 12px;
          margin: 12px 0 0;
        }
        .timeline-step {
          border: 1px solid #eadb95;
          border-radius: 16px;
          background: #fffef8;
          padding: 14px;
          display: grid;
          gap: 6px;
        }
        .timeline-step strong {
          color: #1f1b08;
          font-size: 1rem;
        }
        .timeline-step span {
          color: #4b5563;
        }
        .big-action {
          display: block;
          width: 100%;
          padding: 16px 18px;
          font-size: 1rem;
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
        .mini-list {
          display: grid;
          gap: 10px;
          margin-top: 16px;
        }
        .mini-item {
          border: 1px solid #eadb95;
          border-radius: 14px;
          background: #fffef8;
          padding: 12px 14px;
        }
        .mini-item strong {
          display: block;
          color: var(--lb-muted);
          font-size: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 0.7px;
          margin-bottom: 6px;
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
        .button-link {
          display: inline-block;
          border-radius: 14px;
          padding: 12px 16px;
          background: linear-gradient(180deg, var(--lb-accent) 0%, var(--lb-accent-strong) 100%);
          color: var(--lb-accent-ink);
          font: inherit;
          font-weight: 800;
          text-decoration: none;
          box-shadow: 0 10px 26px rgba(255, 204, 0, 0.18);
        }
        code {
          font-family: "SFMono-Regular", Menlo, monospace;
          font-size: 0.92em;
          word-break: break-all;
        }
        .source-list {
          display: grid;
          gap: 12px;
          margin-bottom: 18px;
        }
        .source-card {
          border: 1px solid #eadb95;
          border-radius: 16px;
          background: #fffef8;
          padding: 14px;
        }
        .source-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 12px;
        }
        .source-actions button {
          padding: 10px 14px;
          font-size: 0.95rem;
        }
        .source-card strong {
          display: block;
          margin-bottom: 6px;
          font-size: 1rem;
        }
        .source-meta {
          display: grid;
          gap: 6px;
          color: var(--lb-muted);
          font-size: 0.95rem;
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
          grid-template-columns: 1fr;
          gap: 10px;
          margin: 8px 0 16px;
        }
        .check-grid label {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid #e6d78a;
          background: #fffdf4;
        }
        .check-grid input {
          width: 20px;
          height: 20px;
          margin: 2px 0 0;
          flex: 0 0 auto;
        }
        .check-grid span {
          display: block;
          min-width: 0;
          word-break: break-word;
          font-size: 0.98rem;
        }
        .step-list {
          margin: 10px 0 0;
          padding-left: 20px;
          color: #4b5563;
        }
        .guide-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          margin: 12px 0 18px;
        }
        .guide-card {
          border: 1px solid #eadb95;
          border-radius: 16px;
          background: #fffef8;
          padding: 14px;
        }
        .guide-card h3 {
          margin: 0 0 8px;
          font-size: 1rem;
        }
        .guide-card p,
        .guide-card ul {
          margin: 0;
          color: #4b5563;
        }
        .guide-card ul {
          padding-left: 18px;
        }
        .method-grid {
          display: grid;
          gap: 14px;
          margin-top: 12px;
        }
        .method-card {
          border: 1px solid #eadb95;
          border-radius: 18px;
          background: #fffef8;
          padding: 16px;
          display: grid;
          gap: 10px;
        }
        .method-badge {
          display: inline-block;
          width: fit-content;
          padding: 5px 10px;
          border-radius: 999px;
          background: rgba(255, 204, 0, 0.18);
          color: #6b5200;
          font-weight: 800;
          font-size: 0.78rem;
          text-transform: uppercase;
          letter-spacing: 0.6px;
        }
        .method-card h3 {
          margin: 0;
          font-size: 1.1rem;
        }
        .method-card p {
          margin: 0;
          color: #4b5563;
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
          .check-grid {
            grid-template-columns: 1fr;
          }
          .stat-grid {
            grid-template-columns: 1fr;
          }
          .guide-grid {
            grid-template-columns: 1fr;
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
  const guildTokens = dashboard.guildTokens || null;
  const authDraft = dashboard.authDraft || null;
  const availableLeagues = Array.isArray(dashboard.availableLeagues) ? dashboard.availableLeagues : [];
  const leagueName = connection?.leagueName || '';
  const leagueExternalId = connection?.leagueExternalId || '';
  const status = connection?.status || 'not_connected';
  const guildName = dashboard.session?.guildName || `Discord Server ${dashboard.session?.guildId || ''}`;
  const selectedPersona = dashboard.session?.selectedPersona || null;
  const selectedLeague = dashboard.session?.selectedLeague || null;
  const leagueFetchError = dashboard.leagueFetchError || '';

  const exportRows = exportSources.length
    ? exportSources.map((source) => `
        <div class="source-card">
          <strong>${escapeHtml(source.label)}</strong>
          <div class="source-meta">
            <div><code>${escapeHtml(source.exportUrl)}</code></div>
            <div>Mode: ${source.autoUpdate ? '<span class="pill">Auto</span>' : 'Manual'}</div>
            <div>Last Import: ${escapeHtml(source.lastImportAt ? new Date(source.lastImportAt).toLocaleString() : 'Never')}</div>
            <div>Status: ${escapeHtml(source.lastImportStatus || 'never')}${source.lastImportError ? ` • ${escapeHtml(source.lastImportError)}` : ''}</div>
          </div>
          <form method="POST" action="/madden/connect/import-source?token=${encodeURIComponent(token)}">
            <input type="hidden" name="export_source_id" value="${escapeHtml(source.id)}" />
            <div class="source-actions">
              <button type="submit">Import Now</button>
            </div>
          </form>
        </div>
      `).join('')
    : `<div class="source-card" style="color:#6b7280;">No export links added yet.</div>`;

  const personaDraftRows = Array.isArray(authDraft?.personas) && authDraft.personas.length
    ? authDraft.personas.map((persona) => `
        <option value="${escapeHtml(persona.personaId)}">
          ${escapeHtml(persona.displayName)} - ${escapeHtml(persona.systemConsole || 'unknown').toUpperCase()} - ${escapeHtml(persona.entitlement || 'Madden')}
        </option>
      `).join('')
    : '';

  const leagueRows = availableLeagues.length
    ? availableLeagues.map((league) => {
      const leagueId = escapeHtml(
        league?.leagueId
        || league?.id
        || league?.league?.leagueId
        || league?.league?.id
        || '',
      );
      const leagueNameOption = escapeHtml(
        league?.leagueName
        || league?.name
        || league?.league?.leagueName
        || league?.league?.name
        || `League ${leagueId || 'Unknown'}`,
      );
      return `<option value="${leagueId}">${leagueNameOption}</option>`;
    }).join('')
    : '';

  return html(`
    <section class="hero">
      <img src="/madden/assets/lb-official-logo.png" alt="LEAGUEbuddy logo" />
      <div>
        <span class="eyebrow">LEAGUEbuddy Madden</span>
        <h1>League Dashboard Setup</h1>
        <p>Set up your league here first, then finish the rest in Discord. Connect EA, choose your Madden account, choose your league, and LEAGUEbuddy will handle the rest.</p>
      </div>
    </section>
    <div class="layout">
      <div class="stack">
        <section class="panel">
          ${noticeBanner(notice)}
          <h2>Setup Overview</h2>
          <p style="color:#4b5563;">This dashboard is already linked to your Discord server. Complete these steps in order.</p>
          <div class="timeline">
            <div class="timeline-step">
              <strong>1. Name your league</strong>
              <span>Save the league name so this server knows what it belongs to.</span>
            </div>
            <div class="timeline-step">
              <strong>2. Connect EA</strong>
              <span>Use the reverse login flow and paste the returned URL back here.</span>
            </div>
            <div class="timeline-step">
              <strong>3. Choose account and league</strong>
              <span>Select the Madden persona and league LEAGUEbuddy should manage.</span>
            </div>
            <div class="timeline-step">
              <strong>4. Return to Discord</strong>
              <span>Run <code>/league-status</code> and continue the normal server setup there.</span>
            </div>
          </div>
        </section>

        <section class="panel">
          <h2>Step 1: Name Your League</h2>
          <p style="color:#4b5563;">Start here for a real league.</p>
          <div class="guide-grid">
            <div class="guide-card">
              <h3>What this step does</h3>
              <ul>
                <li>Ties this dashboard to your Discord server</li>
                <li>Creates the league record LEAGUEbuddy will use</li>
                <li>Prepares the rest of the setup flow</li>
              </ul>
            </div>
            <div class="guide-card">
              <h3>What happens next</h3>
              <ul>
                <li>Connect EA</li>
                <li>Choose your Madden account</li>
                <li>Choose the league to link</li>
              </ul>
            </div>
          </div>
          <form method="POST" action="/madden/connect/league?token=${encodeURIComponent(token)}">
            <label for="league_name"><strong>League Name</strong></label><br />
            <input id="league_name" name="league_name" value="${escapeHtml(leagueName)}" placeholder="Ghost Legacy" required />
            <label for="league_external_id"><strong>League ID</strong> <span style="color:#6b7280;">(optional)</span></label><br />
            <input id="league_external_id" name="league_external_id" value="${escapeHtml(leagueExternalId)}" placeholder="Use this only if you already know the league ID" />
            <button type="submit">Save League Name</button>
          </form>
        </section>

        <section class="panel">
          <h2>Step 2: Connect EA</h2>
          <p style="color:#4b5563;">This follows the same reverse login idea used by Snallabot-style tools. You log in with EA in a browser, then paste the returned local URL here.</p>
          <div class="info">
            <strong>How to connect EA:</strong>
            <ol class="step-list">
              <li>Click <strong>Open EA Login</strong>.</li>
              <li>Sign in with EA in the new tab.</li>
              <li>After login, copy the full URL from your browser if it starts with <code>http://127.0.0.1</code>.</li>
              <li>Paste that full URL here and submit it.</li>
            </ol>
          </div>
          <div class="method-grid">
            <div class="method-card">
              <span class="method-badge">${guildTokens ? 'Connected' : 'Required'}</span>
              <h3>EA Account Connection</h3>
              <p>${guildTokens ? `Connected as ${escapeHtml(guildTokens.personaName || guildTokens.blazeId || 'EA account')}.` : 'Start the EA login flow, then paste the returned URL below.'}</p>
              <div class="source-actions">
                <a class="button-link" href="${escapeHtml(dashboard.authUrl)}" target="_blank" rel="noreferrer">Open EA Login</a>
              </div>
              <form method="POST" action="/madden/connect/ea-callback-url?token=${encodeURIComponent(token)}">
                <label for="redirect_url"><strong>Returned Browser URL</strong></label><br />
                <input id="redirect_url" name="redirect_url" placeholder="http://127.0.0.1:4001/madden/callback?code=..." required />
                <button type="submit"${connection ? '' : ' disabled'}>Save EA Login</button>
                ${connection ? '' : '<p class="warning">Save the league name first.</p>'}
              </form>
            </div>
          </div>
        </section>

        <section class="panel">
          <h2>Step 3: Choose Madden Account</h2>
          <p style="color:#4b5563;">After EA login is captured, choose the correct Madden account/persona for this league.</p>
          ${authDraft?.personas?.length ? `
            <form method="POST" action="/madden/connect/persona?token=${encodeURIComponent(token)}">
              <label for="persona_id"><strong>Available Personas</strong></label><br />
              <select id="persona_id" name="persona_id" required>
                ${personaDraftRows}
              </select>
              <button type="submit">Use This Madden Account</button>
            </form>
          ` : selectedPersona ? `
            <div class="source-card">
              <strong>${escapeHtml(selectedPersona.displayName)}</strong>
              <div class="source-meta">
                <div>Console: ${escapeHtml(selectedPersona.systemConsole || 'unknown')}</div>
                <div>Entitlement: ${escapeHtml(selectedPersona.entitlement || 'Madden')}</div>
              </div>
            </div>
          ` : `
            <div class="source-card" style="color:#6b7280;">Connect EA first. Your available Madden accounts will appear here.</div>
          `}
        </section>

        <section class="panel">
          <h2>Step 4: Choose League</h2>
          <p style="color:#4b5563;">Choose the league LEAGUEbuddy should connect to this Discord server.</p>
          ${leagueFetchError ? `<div class="warning">${escapeHtml(leagueFetchError)}</div>` : ''}
          ${availableLeagues.length ? `
            <form method="POST" action="/madden/connect/league-select?token=${encodeURIComponent(token)}">
              <label for="selected_league_id"><strong>Available Leagues</strong></label><br />
              <select id="selected_league_id" name="league_id" required>
                ${leagueRows}
              </select>
              <button type="submit">Connect This League</button>
            </form>
          ` : selectedLeague ? `
            <div class="source-card">
              <strong>${escapeHtml(selectedLeague.leagueName || 'Connected League')}</strong>
              <div class="source-meta">
                <div>League ID: <code>${escapeHtml(selectedLeague.leagueId || 'unknown')}</code></div>
              </div>
            </div>
          ` : `
            <div class="source-card" style="color:#6b7280;">Connect EA and choose a Madden account first. Then your leagues will appear here.</div>
          `}
        </section>

        <section class="panel">
          <h2>League Landing Page</h2>
          <p style="color:#4b5563;">Once your league is connected, this page becomes the home for sync status and league info.</p>
          <div class="source-card">
            <strong>${escapeHtml(connection?.leagueName || selectedLeague?.leagueName || 'No league connected yet')}</strong>
            <div class="source-meta">
              <div>Source: ${escapeHtml(connection?.sourceType || 'ea_dashboard')}</div>
              <div>Status: ${escapeHtml(status)}</div>
              <div>Week: ${escapeHtml(snapshot?.summary?.week || connection?.summary?.week || 'unknown')}</div>
              <div>League ID: <code>${escapeHtml(connection?.leagueExternalId || selectedLeague?.leagueId || leagueExternalId || 'unknown')}</code></div>
            </div>
          </div>
        </section>

        <section class="panel">
          <h2>Support Tools</h2>
          <p style="color:#4b5563;">These are not part of the normal customer setup path.</p>
          <details>
            <summary>Testing only: Load demo league</summary>
            <form method="POST" action="/madden/connect/demo?token=${encodeURIComponent(token)}" style="margin-top:16px;">
              <button type="submit" class="big-action">Load Demo League</button>
            </form>
            <div class="subtle">This fills the dashboard with sample data for testing only.</div>
          </details>
          <details>
            <summary>Support only: JSON importer</summary>
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
          <div class="mini-list">
            <div class="mini-item">
              <strong>Linked Discord Server</strong>
              <div>${escapeHtml(guildName)}</div>
            </div>
            <div class="mini-item">
              <strong>Server ID</strong>
              <div><code>${escapeHtml(dashboard.session?.guildId || 'unknown')}</code></div>
            </div>
          </div>
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
            <li>Connect EA and paste the returned browser URL.</li>
            <li>Choose your Madden account/persona.</li>
            <li>Choose your league.</li>
            <li>Go back to Discord and run <code>/league-status</code>.</li>
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
      const dashboard = await connectionService.getLeagueConnectionDashboardState(token);
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
    path: '/madden/connect/ea-callback-url',
    handler: async (req, res) => {
      const token = parseToken(req);
      const form = parseForm(await readBody(req));
      const result = await connectionService.submitEaRedirectUrl({
        token,
        redirectUrl: form.get('redirect_url'),
      });
      const location = result.ok
        ? `/madden/connect?token=${encodeURIComponent(token)}&notice=${encodeURIComponent('EA login saved. Choose your Madden account below.')}`
        : `/madden/connect?token=${encodeURIComponent(token)}&notice=${encodeURIComponent(result.message)}`;
      res.writeHead(302, { location });
      res.end();
    },
  });

  registerHttpRoute({
    method: 'POST',
    path: '/madden/connect/persona',
    handler: async (req, res) => {
      const token = parseToken(req);
      const form = parseForm(await readBody(req));
      const result = await connectionService.submitEaPersona({
        token,
        personaId: form.get('persona_id'),
      });
      const location = result.ok
        ? `/madden/connect?token=${encodeURIComponent(token)}&notice=${encodeURIComponent('Madden account selected. Choose your league below.')}`
        : `/madden/connect?token=${encodeURIComponent(token)}&notice=${encodeURIComponent(result.message)}`;
      res.writeHead(302, { location });
      res.end();
    },
  });

  registerHttpRoute({
    method: 'POST',
    path: '/madden/connect/league-select',
    handler: async (req, res) => {
      const token = parseToken(req);
      const form = parseForm(await readBody(req));
      const result = await connectionService.selectEaLeague({
        token,
        leagueId: form.get('league_id'),
      });
      const location = result.ok
        ? `/madden/connect?token=${encodeURIComponent(token)}&notice=${encodeURIComponent('League connected. Return to Discord and run /league-status.')}`
        : `/madden/connect?token=${encodeURIComponent(token)}&notice=${encodeURIComponent(result.message)}`;
      res.writeHead(302, { location });
      res.end();
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
    path: '/madden/connect/import-source',
    handler: async (req, res) => {
      const token = parseToken(req);
      const form = parseForm(await readBody(req));
      const result = await connectionService.importFromExportSource({
        token,
        exportSourceId: form.get('export_source_id'),
      });
      const location = result.ok
        ? `/madden/connect?token=${encodeURIComponent(token)}&notice=${encodeURIComponent('Import complete. Go back to Discord and run /league-status.')}`
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
