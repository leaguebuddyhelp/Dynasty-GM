import http from 'http';
import { URL } from 'url';

let server = null;
let ready = false;
const routes = [];

function shouldEnable() {
  return String(process.env.LB_HEALTHCHECK_ENABLED || '').toLowerCase() === 'true'
    || String(process.env.PORT || '').trim().length > 0
    || routes.length > 0;
}

export function registerHttpRoute({ method = 'GET', path, handler }) {
  if (!path || typeof handler !== 'function') {
    throw new Error('registerHttpRoute requires a path and handler');
  }
  routes.push({
    method: String(method).toUpperCase(),
    path: String(path),
    handler,
  });
}

export function markHealthReady(value = true) {
  ready = !!value;
}

export function startHealthcheckServer() {
  if (!shouldEnable() || server) return server;

  const port = Number(process.env.LB_HEALTHCHECK_PORT || process.env.PORT || 8080);
  server = http.createServer(async (req, res) => {
    let pathname = String(req.url || '');
    try {
      pathname = new URL(String(req.url || '/'), 'http://127.0.0.1').pathname;
    } catch {
      // ignore and fall back to raw url
    }
    const matched = routes.find((route) =>
      route.method === String(req.method || 'GET').toUpperCase() && route.path === pathname,
    );
    if (matched) {
      try {
        await matched.handler(req, res);
      } catch {
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        }
        if (!res.writableEnded) res.end(JSON.stringify({ ok: false }));
      }
      return;
    }
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
  registerHttpRoute,
  startHealthcheckServer,
};
