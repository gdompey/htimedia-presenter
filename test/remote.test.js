const test = require('node:test');
const assert = require('node:assert');
const { RemoteServer, remoteHtml } = require('../src/main/remote.js');

test('remote enforces the PIN and only accepts known commands', async () => {
  const received = [];
  const server = new RemoteServer({ getState: () => ({ title: 'Song', index: 2 }), onCommand: c => received.push(c), htmlFile: remoteHtml });
  await server.start({ port: 0, pin: '2468' });
  const port = server.server.address().port;
  const base = 'http://127.0.0.1:' + port;
  try {
    assert.strictEqual((await fetch(base + '/')).status, 200);
    assert.strictEqual((await fetch(base + '/api/state')).status, 401);
    assert.strictEqual((await fetch(base + '/api/state?pin=0000')).status, 401);
    const state = await (await fetch(base + '/api/state?pin=2468')).json();
    assert.strictEqual(state.title, 'Song');
    const ok = await fetch(base + '/api/cmd?pin=2468', { method: 'POST', body: JSON.stringify({ cmd: 'next' }) });
    assert.strictEqual(ok.status, 200);
    const bad = await fetch(base + '/api/cmd?pin=2468', { method: 'POST', body: JSON.stringify({ cmd: 'quit' }) });
    assert.strictEqual(bad.status, 400);
    assert.deepStrictEqual(received, [{ cmd: 'next', index: 0 }]);
  } finally {
    server.stop();
  }
});
