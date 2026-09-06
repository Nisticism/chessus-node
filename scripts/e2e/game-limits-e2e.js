/*
 * Simultaneous-game cap suite.
 *
 * Two halves: the tier table is asserted through a hook (creating 40
 * correspondence games to find an edge is not a test, it is a waiting room),
 * and the enforcement path is proved end to end at the free tier, where the cap
 * is small enough to actually reach.
 *
 * Start a hooked backend on a spare port:
 *
 *   bash:        ENABLE_TEST_HOOKS=1 PORT=3002 node server/index.js
 *   PowerShell:  $env:ENABLE_TEST_HOOKS=1; $env:PORT=3002; node server/index.js
 *
 * then:
 *
 *   TEST_SERVER_URL=http://localhost:3002 node scripts/e2e/game-limits-e2e.js
 *
 * Needs the e2e_* fixture users (see scripts/e2e/fixtures.sql).
 */
const { connect, once, createHumanGame, resign, run, wait } = require('./lib/harness');

const GAME_TYPE_ID = parseInt(process.env.TEST_GAME_TYPE_ID || '18', 10);
// The sparring partner has to be uncapped: it ends up in every game the capped
// user creates, so a normal account would hit its OWN limit partway through and
// fail the test for the wrong reason. That is what the owner fixture is for.
let OPPONENT = null;

const ask = (sock, event, payload, ms = 8000) =>
  new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error(`no ack for ${event} - backend running with ENABLE_TEST_HOOKS=1?`)), ms);
    sock.emit(event, payload, (res) => { clearTimeout(to); resolve(res); });
  });

// Resolved by username so the suite does not care what ids the fixtures got.
const FIXTURES = ['e2e_free', 'e2e_silver', 'e2e_gold', 'e2e_admin', 'e2e_owner'];

const EXPECTED = {
  e2e_free:   { tier: 'free',      live: 4,           correspondence: 12 },
  e2e_silver: { tier: 'supporter', live: 10,          correspondence: 40 },
  e2e_gold:   { tier: 'supporter', live: 10,          correspondence: 40 },
  e2e_admin:  { tier: 'admin',     live: 10,          correspondence: 40 },
  e2e_owner:  { tier: 'owner',     live: 'unlimited', correspondence: 'unlimited' },
};

let fixtureIds = null;
async function loadFixtureIds() {
  if (fixtureIds) return fixtureIds;
  const ids = JSON.parse(process.env.E2E_FIXTURE_IDS || 'null');
  if (!ids) {
    throw new Error('set E2E_FIXTURE_IDS to a {"e2e_free":533,...} map (see scripts/e2e/fixtures.sql)');
  }
  for (const name of FIXTURES) {
    if (!ids[name]) throw new Error(`fixture user ${name} missing from E2E_FIXTURE_IDS`);
  }
  fixtureIds = ids;
  OPPONENT = { id: ids.e2e_owner, name: 'e2e_owner' };
  return ids;
}

const checks = [
  {
    name: 'each tier resolves to the caps it should',
    fn: async (ctx) => {
      const ids = await loadFixtureIds();
      const probe = await connect({ id: ids.e2e_admin, name: 'e2e_admin' });
      ctx.onCleanup(() => { try { probe.close(); } catch (_) {} });

      const wrong = [];
      for (const name of FIXTURES) {
        const got = await ask(probe, '__test:limits', { userId: ids[name] });
        if (!got.ok) throw new Error(`${name}: ${got.error}`);
        const want = EXPECTED[name];
        if (got.tier !== want.tier || got.live !== want.live || got.correspondence !== want.correspondence) {
          wrong.push(`${name}: got ${got.tier} ${got.live}/${got.correspondence}, want ${want.tier} ${want.live}/${want.correspondence}`);
        }
      }
      if (wrong.length) throw new Error(wrong.join('; '));
    },
  },
  {
    name: 'a free user is stopped at their 5th live game',
    fn: async (ctx) => {
      const ids = await loadFixtureIds();
      const free = { id: ids.e2e_free, name: 'e2e_free' };
      const host = await connect(free);
      const opp = await connect(OPPONENT);
      ctx.onCleanup(() => { try { host.close(); } catch (_) {} });
      ctx.onCleanup(() => { try { opp.close(); } catch (_) {} });

      // Fill the 4 slots. These are live games with a joined opponent, which is
      // what countActiveLiveGames counts.
      const made = [];
      for (let i = 0; i < 4; i++) {
        const g = await createHumanGame({
          hostSock: host, joinSock: opp, host: free, joiner: OPPONENT,
          gameTypeId: GAME_TYPE_ID, timeControl: 10,
        });
        made.push(g.gameId);
      }
      ctx.onCleanup(async () => { for (const id of made) await resign(host, id, free.id); });

      // The 5th must be refused, with the numbers the modal renders.
      const refused = once(host, 'error', (e) => e.code === 'LIMIT_EXCEEDED', 10000, 'LIMIT_EXCEEDED');
      host.emit('createGame', {
        gameTypeId: GAME_TYPE_ID, timeControl: 10, increment: 0,
        hostId: free.id, hostUsername: free.name, vsComputer: false,
        allowSpectators: true, allowPremoves: true, playerSide: 'p1',
      });
      const err = await refused;
      if (err.limitType !== 'live') throw new Error(`wrong limitType: ${err.limitType}`);
      if (err.limitMax !== 4) throw new Error(`reported cap ${err.limitMax}, expected 4`);
      if (err.limitCount < 4) throw new Error(`reported count ${err.limitCount}, expected at least 4`);
    },
  },
  {
    name: 'a capped free user cannot JOIN a fifth game either',
    fn: async (ctx) => {
      const ids = await loadFixtureIds();
      const free = { id: ids.e2e_free, name: 'e2e_free' };
      const capped = await connect(free);
      const opp = await connect(OPPONENT);
      ctx.onCleanup(() => { try { capped.close(); } catch (_) {} });
      ctx.onCleanup(() => { try { opp.close(); } catch (_) {} });

      const made = [];
      for (let i = 0; i < 4; i++) {
        const g = await createHumanGame({
          hostSock: capped, joinSock: opp, host: free, joiner: OPPONENT,
          gameTypeId: GAME_TYPE_ID, timeControl: 10,
        });
        made.push(g.gameId);
      }
      ctx.onCleanup(async () => { for (const id of made) await resign(capped, id, free.id); });

      // Someone ELSE hosts an open game; the capped player tries to join it.
      const hostedP = once(opp, 'gameCreated', null, 10000, 'gameCreated');
      opp.emit('createGame', {
        gameTypeId: GAME_TYPE_ID, timeControl: 10, increment: 0,
        hostId: OPPONENT.id, hostUsername: OPPONENT.name, vsComputer: false,
        allowSpectators: true, allowPremoves: true, playerSide: 'p1',
      });
      const hosted = await hostedP;
      ctx.onCleanup(() => resign(opp, hosted.gameId, OPPONENT.id));

      const refused = once(capped, 'error', (e) => e.code === 'LIMIT_EXCEEDED', 10000, 'LIMIT_EXCEEDED');
      capped.emit('joinGame', { gameId: hosted.gameId, userId: free.id, username: free.name });
      const err = await refused;
      if (err.limitType !== 'live') throw new Error(`wrong limitType: ${err.limitType}`);
      if (err.limitMax !== 4) throw new Error(`reported cap ${err.limitMax}, expected 4`);
    },
  },
  {
    name: 'the owner is not capped',
    fn: async (ctx) => {
      const ids = await loadFixtureIds();
      const probe = await connect({ id: ids.e2e_owner, name: 'e2e_owner' });
      ctx.onCleanup(() => { try { probe.close(); } catch (_) {} });
      const got = await ask(probe, '__test:limits', { userId: ids.e2e_owner });
      if (got.live !== 'unlimited' || got.correspondence !== 'unlimited') {
        throw new Error(`owner is capped at ${got.live}/${got.correspondence}`);
      }
    },
  },
];

run('Simultaneous game caps', checks).then((ok) => process.exit(ok ? 0 : 1));
