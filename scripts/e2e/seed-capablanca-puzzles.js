/*
 * Seed real Capablanca puzzles.
 *
 * The positions live in scripts/e2e/capablanca-candidates.js and can be checked
 * offline with scripts/e2e/puzzle-lab.js. Every one is put through the SAME
 * validator the builder uses before it is published, so nothing gets seeded on
 * the strength of my own analysis: mate candidates that turn out not to be mate,
 * or to have several mates, are reported rather than quietly published.
 *
 *   node scripts/e2e/seed-capablanca-puzzles.js
 *
 * Re-running is safe - a title that already exists for this game type is left
 * alone rather than duplicated.
 *
 * Dev/local only; it publishes puzzles owned by TEST_P1_ID.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const jwt = require('jsonwebtoken');
const { GAME_TYPE_ID, CANDIDATES } = require('./capablanca-candidates');

const BASE = process.env.TEST_SERVER_URL || 'http://localhost:3001';
const OWNER = { id: parseInt(process.env.TEST_P1_ID || '40', 10), name: process.env.TEST_P1_NAME || 'Nisticism' };

const token = jwt.sign(
  { id: OWNER.id, username: OWNER.name, role: null, admin_level: null },
  process.env.ACCESS_TOKEN_SECRET, { expiresIn: '15m' }
);
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

const api = async (method, url, body) => {
  const r = await fetch(`${BASE}${url}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch (_) { j = t.slice(0, 200); }
  return { status: r.status, body: j };
};

(async () => {
  const existing = await api('GET', `/api/game-types/${GAME_TYPE_ID}/puzzles?limit=100`);
  const seen = new Set((existing.body?.puzzles || []).map((p) => p.title));

  const summary = [];
  for (const c of CANDIDATES) {
    if (seen.has(c.title)) {
      summary.push({ title: c.title, outcome: 'already seeded' });
      continue;
    }
    const created = await api('POST', `/api/game-types/${GAME_TYPE_ID}/puzzles`, {
      title: c.title,
      description: c.description,
      position: c.position,
      side_to_move: c.side_to_move,
      goal: c.goal,
      goal_description: c.goal_description || null,
      solution_line: Array.isArray(c.line) ? c.line : [c.solution],
    });
    if (created.status !== 201) {
      summary.push({ title: c.title, outcome: `create failed (${created.status})`, detail: created.body?.message });
      continue;
    }
    const id = created.body.puzzle.id;

    const validated = await api('POST', `/api/puzzles/${id}/validate`, {});
    const v = validated.body || {};

    // Only publish something the server is happy with, or that it cannot judge.
    const publishable = v.status === 'valid' || v.status === 'not_checkable';
    if (publishable) await api('POST', `/api/puzzles/${id}/publish`, { publish: true });

    summary.push({
      id, title: c.title, goal: c.goal,
      validation: v.status,
      solutions: v.solutionCount,
      published: publishable,
      detail: v.detail || null,
    });
  }
  console.log(JSON.stringify(summary, null, 1));
  const good = summary.filter((s) => s.published).length;
  console.log(`\n${good} published, ${summary.filter((s) => s.outcome === 'already seeded').length} already present`);
  process.exit(0);
})();
