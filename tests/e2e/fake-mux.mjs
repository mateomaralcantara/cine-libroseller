// Mux simulado para pruebas: API de subidas directas, recepción por partes (como UpChunk) y un asset
// que «procesa» unos segundos. No envía webhooks: así se prueba también la consulta automática del panel.
import http from 'node:http';

export function startFakeMux(port) {
  const uploads = {};
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PUT,OPTIONS', 'access-control-allow-headers': '*', 'access-control-expose-headers': '*' };
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const send = (code, data) => { res.writeHead(code, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify({ data })); };
    if (req.method === 'POST' && u.pathname === '/video/v1/uploads') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const id = `up${Date.now()}`;
        uploads[id] = { status: 'waiting', passthrough: JSON.parse(body).new_asset_settings.passthrough };
        send(201, { id, url: `http://127.0.0.1:${port}/put/${id}`, status: 'waiting' });
      });
      return;
    }
    if (req.method === 'PUT' && u.pathname.startsWith('/put/')) {
      const id = u.pathname.split('/')[2];
      req.on('data', () => {});
      req.on('end', () => {
        const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(req.headers['content-range'] || '');
        const last = !m || Number(m[2]) + 1 >= Number(m[3]);
        if (last) Object.assign(uploads[id], { status: 'asset_created', asset: `as${id}`, doneAt: Date.now() });
        res.writeHead(last ? 200 : 308, cors); res.end();
      });
      return;
    }
    const up = u.pathname.match(/^\/video\/v1\/uploads\/(.+)$/);
    if (up && uploads[up[1]]) return send(200, { id: up[1], status: uploads[up[1]].status, asset_id: uploads[up[1]].asset });
    const as = u.pathname.match(/^\/video\/v1\/assets\/as(.+)$/);
    if (as && uploads[as[1]]) {
      const x = uploads[as[1]];
      const ready = Date.now() - x.doneAt > 4000;
      return send(200, { id: `as${as[1]}`, status: ready ? 'ready' : 'preparing', duration: 905.4, aspect_ratio: '16:9', max_stored_resolution: 'HD', passthrough: x.passthrough,
        playback_ids: ready ? [{ id: `PB${as[1]}`, policy: 'public' }] : [], tracks: ready ? [{ id: 'v', type: 'video', max_width: 1920, max_height: 1080 }] : [] });
    }
    res.writeHead(404, cors); res.end();
  }).listen(port, '127.0.0.1');
}
