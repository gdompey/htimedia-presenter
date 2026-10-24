// Runs the Electron UI smoke test against a throwaway profile and prints the result.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'htimedia-selftest-'));
const out = path.join(tmp, 'out');
const electron = require('electron');
const r = spawnSync(electron, ['.'], {
  cwd: path.join(__dirname, '..'),
  env: Object.assign({}, process.env, { HTIMEDIA_SELFTEST: out, HTIMEDIA_USER_DATA: path.join(tmp, 'profile') }),
  stdio: 'inherit',
  timeout: 180000
});
console.log('Screenshots and report: ' + out);
process.exit(r.status == null ? 1 : r.status);
