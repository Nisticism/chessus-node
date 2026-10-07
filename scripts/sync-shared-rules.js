// Writes the frontend copies of the server's shared rule modules - the same
// code, with module.exports turned into an ES export:
//   server/move-paths.js -> chessus-frontend/src/helpers/movePaths.js
//   server/board-wrap.js -> chessus-frontend/src/helpers/boardWrap.js
// Run after changing a server file; scripts/e2e/move-paths-test.js fails until you do.
//   node scripts/sync-shared-rules.js [--check]
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PAIRS = [
  ['server/move-paths.js', 'chessus-frontend/src/helpers/movePaths.js'],
  ['server/board-wrap.js', 'chessus-frontend/src/helpers/boardWrap.js'],
];

// Line endings as git may check them out (CRLF on Windows) do not count.
const CR = String.fromCharCode(13);
const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(CR).join('') : '');

/* The frontend file a server file makes: its "Mirrored by" note becomes a GENERATED one. */
function frontendSource(server) {
  const src = read(path.join(ROOT, server));
  const start = src.indexOf(' * Mirrored by chessus-frontend/');
  const end = src.indexOf(' */', start);
  if (start < 0 || end < 0) throw new Error(`sync-shared-rules: ${server} has no "Mirrored by" note`);
  const note = ` * GENERATED from ${server} by scripts/sync-shared-rules.js - edit\n * that file and re-run the script; scripts/e2e/move-paths-test.js checks.\n`;
  const out = (src.slice(0, start) + note + src.slice(end)).replace(/module\.exports = \{/, 'export {');
  if (!out.includes('export {')) throw new Error(`sync-shared-rules: ${server} has no module.exports`);
  return out;
}
const frontendNow = (frontend) => read(path.join(ROOT, frontend));
/** [server, frontend] pairs whose frontend copy is out of date. */
const outOfSync = () => PAIRS.filter(([s, f]) => frontendNow(f) !== frontendSource(s));

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const stale = outOfSync();
    for (const [, f] of stale) console.log(`${f} is OUT OF SYNC - run node scripts/sync-shared-rules.js`);
    if (!stale.length) console.log('shared rule modules are in sync');
    process.exit(stale.length ? 1 : 0);
  }
  for (const [s, f] of PAIRS) {
    fs.writeFileSync(path.join(ROOT, f), frontendSource(s));
    console.log('wrote', f);
  }
}

module.exports = { PAIRS, frontendSource, frontendNow, outOfSync };
