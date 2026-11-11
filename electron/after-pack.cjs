// After packaging (electron-builder): the macOS app is signed ad hoc. Without any signature an app does not
// start on Apple silicon at all; an ad-hoc signature is enough to run it (Gatekeeper still asks on first
// start, because the app is not notarised by Apple).
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
