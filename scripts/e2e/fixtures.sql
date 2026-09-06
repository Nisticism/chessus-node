-- Fixture users for the e2e suites, one per privilege tier.
--
-- Local/dev databases only. They have no usable password (auth in the suites is
-- a socket `authenticate` by id, which is all the dev server asks for), so they
-- cannot be logged into through the site.
--
--   mysql -u root -p chessusnode < scripts/e2e/fixtures.sql
--
-- Then pass the ids to a suite:
--   E2E_FIXTURE_IDS='{"e2e_free":533,"e2e_silver":534,...}' node scripts/e2e/game-limits-e2e.js
--
-- Note e2e_owner carries role='owner'. getOwnerUserId() orders by id, so the
-- real owner (a lower id) still wins anything that routes to "the owner".

INSERT INTO users (username, password, email, role, total_donations, allow_non_friend_dms, sound_enabled)
VALUES
  ('e2e_free',   '', 'e2e_free@example.invalid',   NULL,     0.00, 1, 1),
  ('e2e_silver', '', 'e2e_silver@example.invalid', NULL,     5.00, 1, 1),
  ('e2e_gold',   '', 'e2e_gold@example.invalid',   NULL,    50.00, 1, 1),
  ('e2e_admin',  '', 'e2e_admin@example.invalid',  'admin',  0.00, 1, 1),
  ('e2e_owner',  '', 'e2e_owner@example.invalid',  'owner',  0.00, 1, 1)
ON DUPLICATE KEY UPDATE
  role = VALUES(role),
  total_donations = VALUES(total_donations);

SELECT CONCAT(
  '{', GROUP_CONCAT(CONCAT('"', username, '":', id) ORDER BY id SEPARATOR ','), '}'
) AS E2E_FIXTURE_IDS
FROM users WHERE username LIKE 'e2e\\_%';
