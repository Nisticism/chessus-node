-- Migration: Column cleanup and new features
-- Removes unused columns, adds repeating ratio capture, can_capture_allies

-- ============ DELETE UNUSED COLUMNS ============

-- Tier 1: Dead columns (never written, always NULL)
ALTER TABLE pieces DROP COLUMN IF EXISTS game_type_id;
ALTER TABLE pieces DROP COLUMN IF EXISTS promotion_options;

-- Tier 2: Repeating iteration columns (never used by engine)
ALTER TABLE pieces DROP COLUMN IF EXISTS min_directional_movement_iterations;
ALTER TABLE pieces DROP COLUMN IF EXISTS max_directional_movement_iterations;
ALTER TABLE pieces DROP COLUMN IF EXISTS min_ratio_iterations;

-- Tier 2: Ranged attack repeating columns (never used by engine)
ALTER TABLE pieces DROP COLUMN IF EXISTS repeating_directional_ranged_attack;
ALTER TABLE pieces DROP COLUMN IF EXISTS max_directional_ranged_attack_iterations;
ALTER TABLE pieces DROP COLUMN IF EXISTS min_directional_ranged_attack_iterations;
ALTER TABLE pieces DROP COLUMN IF EXISTS repeating_ratio_ranged_attack;
ALTER TABLE pieces DROP COLUMN IF EXISTS max_ratio_ranged_attack_iterations;
ALTER TABLE pieces DROP COLUMN IF EXISTS min_ratio_ranged_attack_iterations;

-- Tier 3: Unimplemented ally capture flags (replaced by can_capture_allies)
ALTER TABLE pieces DROP COLUMN IF EXISTS can_capture_ally_via_range;
ALTER TABLE pieces DROP COLUMN IF EXISTS can_capture_ally_on_range;
ALTER TABLE pieces DROP COLUMN IF EXISTS can_attack_on_iteration;

-- ============ ADD NEW COLUMNS ============

-- Repeating ratio capture (mirrors repeating_ratio for capture)
ALTER TABLE pieces ADD COLUMN repeating_ratio_capture TINYINT(1) DEFAULT 0;

-- Max ratio capture iterations (-1 for infinite, positive for limit)
ALTER TABLE pieces ADD COLUMN max_ratio_capture_iterations INT DEFAULT NULL;

-- Global "can capture allies" flag
ALTER TABLE pieces ADD COLUMN can_capture_allies TINYINT(1) DEFAULT 0;
