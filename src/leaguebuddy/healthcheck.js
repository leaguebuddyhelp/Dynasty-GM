import http from 'http';

let server = null;
let ready = false;

function shouldEnable() {
  return String(process.env.LB_HEALTHCHECK_ENABLED || '').toLowerCase() === 'true' || String(process.env.PORT || '').trim().length > 0;
}

export function markHealthReady(value = true) {
  ready = !!value;
}

export function startHealthcheckServer() {
  if (!shouldEnable() || server) return server;

  const port = Number(process.env.LB_HEALTHCHECK_PORT || process.env.PORT || 8080);
  server = http.createServer((req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    const status = ready ? 200 : 503;
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: ready }));
  });
  server.listen(port, () => {
    console.log(`[health] listening on port ${port}`);
  });
  return server;
}

export default {
  markHealthReady,
  startHealthcheckServer,
};
