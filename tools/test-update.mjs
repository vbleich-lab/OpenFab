// The look for updates: comparing version numbers and choosing the newest release.
// Run: npm run test:update
const ok = (n, c, x = '') => { console.log((c ? 'OK   ' : 'FEHL ') + n + '  ' + x); if (!c) process.exitCode = 1; };
globalThis.localStorage = { getItem: () => null, setItem() {} };
const { compareVersions, newestRelease, parseVersion } = await import('../js/update.js');

ok('Versionsnummer lesen', JSON.stringify(parseVersion('v1.2.3-rc.4')) === '{"n":[1,2,3],"pre":["rc",4]}' && parseVersion('1.0.0').pre === null && parseVersion('abc') === null);
const order = ['1.0.0-rc.1', '1.0.0-rc.2', '1.0.0-rc.10', '1.0.0', '1.0.1-rc.1', '1.0.1', '1.1.0', '2.0.0'];
ok('Reihenfolge: Vorabversionen vor der fertigen, rc.10 nach rc.2', order.every((v, i) => i === 0 || (compareVersions(order[i - 1], v) < 0 && compareVersions(v, order[i - 1]) > 0)) && compareVersions('1.0.0', 'v1.0.0') === 0);

const rel = (tag, o = {}) => ({ tag_name: tag, html_url: 'https://example.invalid/' + tag, prerelease: /-/.test(tag), draft: false, ...o });
const list = [rel('v1.0.0-rc.4'), rel('v1.0.0-rc.5'), rel('v0.9.0'), rel('v1.0.0-rc.9', { draft: true }), rel('nightly')];
ok('Neuere Vorabversion für Nutzer einer Vorabversion', newestRelease(list, '1.0.0-rc.4')?.version === '1.0.0-rc.5', JSON.stringify(newestRelease(list, '1.0.0-rc.4')));
ok('Aktuell: kein Hinweis', newestRelease(list, '1.0.0-rc.5') === null && newestRelease(list, '1.0.0') === null);
ok('Entwürfe und fremde Tags zählen nicht', newestRelease(list, '1.0.0-rc.6') === null);
ok('Wer eine fertige Version hat, bekommt keine Vorabversion angeboten', newestRelease([...list, rel('v1.1.0-rc.1')], '1.0.0') === null && newestRelease([...list, rel('v1.1.0-rc.1'), rel('v1.0.1')], '1.0.0')?.version === '1.0.1');
ok('Fertige Version löst die Vorabversion ab', newestRelease([...list, rel('v1.0.0')], '1.0.0-rc.5')?.version === '1.0.0');
ok('Leere Liste', newestRelease([], '1.0.0') === null && newestRelease(null, '1.0.0') === null);
