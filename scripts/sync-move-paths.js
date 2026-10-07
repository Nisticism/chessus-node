// Writes chessus-frontend/src/helpers/movePaths.js from server/move-paths.js:
// the same code, with module.exports turned into an ES export. Run after
// changing the server file; scripts/e2e/move-paths-test.js fails until you do.
//   node scripts/sync-move-paths.js [--check]
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server/move-paths.js');
const FRONTEND = path.join(ROOT, 'chessus-frontend/src/helpers/movePaths.js');

// Line endings as git may check them out (CRLF on Windows) do not count.
const CR = String.fromCharCode(13);
const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(CR).join('') : '');

function frontendSource() {
  const src = read(SERVER);
  const out = src
    .replace(' * Mirrored by chessus-frontend/src/helpers/movePaths.js - the same code with\n * `export`s; scripts/e2e/move-paths-test.js checks they are identical.',
      ' * GENERATED from server/move-paths.js by scripts/sync-move-paths.js - edit\n * that file and re-run the script; scripts/e2e/move-paths-test.js checks.')
    .replace(/module\.exports = \{/, 'export {');
  if (out === src) throw new Error('sync-move-paths: nothing replaced - did the server file change shape?');
  return out;
}

// The frontend file as it is, line endings aside - for the test.
const frontendNow = () => read(FRONTEND);

if (require.main === module) {
  const want = frontendSource();
  if (process.argv.includes('--check')) {
    const same = frontendNow() === want;
    console.log(same ? 'movePaths.js is in sync' : 'movePaths.js is OUT OF SYNC - run node scripts/sync-move-paths.js');
    process.exit(same ? 0 : 1);
  }
  fs.writeFileSync(FRONTEND, want);
  console.log('wrote', path.relative(ROOT, FRONTEND));
}

module.exports = { frontendSource, frontendNow, FRONTEND };
