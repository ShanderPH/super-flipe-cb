// Use the configured Developer Mode SSH transport without printing credentials.
const path = require('node:path');
const novacom = require(path.resolve(__dirname, '../../tools/webos/node_modules/@webos-tools/cli/lib/base/novacom.js'));
const [mode, device, source, target] = process.argv.slice(2);
if (!['put', 'get'].includes(mode) || !device || !source || !target) throw new Error('Usage: device-file.cjs put|get DEVICE SOURCE TARGET');
const remote = mode === 'put' ? target : source;
if (!/^\/media\/developer\/apps\/usr\/palm\/applications\/com\.superflipcb\.native(?:\.poc)?\/[A-Za-z0-9._/-]+$/.test(remote) || remote.includes('..')) throw new Error('Only Super Flip native app files are allowed');
new novacom.Session(device, false, (error, session) => {
  if (error) { console.error(error.message); process.exitCode = 1; return; }
  session[mode](source, target, (error) => {
    session.end();
    if (error) { console.error(error.message); process.exitCode = 1; }
    else console.log('Transfer complete');
  });
});
