// Optional LAN remote: a phone or tablet on the same network can step slides and clear layers.
// Plain HTTP + Server-Sent Events, no cloud and no extra dependencies. Off by default; PIN protected.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ALLOWED = new Set(['next', 'prev', 'clearAll', 'clearSlide', 'clearMedia', 'clearProps', 'clearMessages', 'logo', 'goto', 'nextItem', 'prevItem']);

class RemoteServer {
  constructor({ getState, onCommand, htmlFile }) {
    this.getState = getState;
    this.onCommand = onCommand;
    this.htmlFile = htmlFile;
    this.server = null;
    this.clients = new Set();
    this.pin = '';
    this.port = 0;
  }

  addresses() {
    const out = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push('http://' + a.address + ':' + this.port);
    }
    return out;
  }

  start({ port, pin }) {
    this.stop();
    this.pin = String(pin || '');
    this.port = port || 4316;
    this.server = http.createServer((req, res) => this.handle(req, res));
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, '0.0.0.0', () => resolve(this.addresses()));
    });
  }

  stop() {
    for (const c of this.clients) { try { c.end(); } catch (e) { /* closed */ } }
    this.clients.clear();
    if (this.server) { this.server.close(); this.server = null; }
  }

  authorised(url) {
    return !this.pin || url.searchParams.get('pin') === this.pin;
  }

  handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      fs.createReadStream(this.htmlFile).pipe(res);
      return;
    }
    if (!this.authorised(url)) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Wrong PIN' }));
      return;
    }
    if (url.pathname === '/api/state') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(this.getState()));
      return;
    }
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write('data: ' + JSON.stringify(this.getState()) + '\n\n');
      this.clients.add(res);
      req.on('close', () => this.clients.delete(res));
      return;
    }
    if (url.pathname === '/api/cmd' && req.method === 'POST') {
      let body = '';
      req.on('data', d => { body += d; if (body.length > 10000) req.destroy(); });
      req.on('end', () => {
        let cmd;
        try { cmd = JSON.parse(body || '{}'); } catch (e) { cmd = {}; }
        if (!ALLOWED.has(cmd.cmd)) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unknown command' }));
          return;
        }
        this.onCommand({ cmd: cmd.cmd, index: Number(cmd.index) || 0 });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      });
      return;
    }
    res.writeHead(404);
    res.end();
  }

  broadcast(state) {
    if (!this.clients.size) return;
    const msg = 'data: ' + JSON.stringify(state) + '\n\n';
    for (const c of this.clients) { try { c.write(msg); } catch (e) { this.clients.delete(c); } }
  }
}

module.exports = { RemoteServer, remoteHtml: path.join(__dirname, '..', 'renderer', 'remote', 'remote.html') };
