# Database Consolidation Cleanup

## ✅ Completed
- Migrated all piece_movement and piece_capture columns into pieces table
- Updated all server queries to use consolidated pieces table
- Updated frontend to handle consolidated data structure
- Added special_scenario_moves validation to backend

## 🗑️ Files/Code to Remove

### SQL Migration File (No longer needed)
- `db/migrations/consolidate-piece-tables.sql` - can be deleted (migration logic now in migrations.js)

### Legacy Table Scripts (Keep for reference, but can archive)
- `scripts/fix-piece-tables.js` - references piece_movement/piece_capture tables
- `scripts/recreate-piece-tables.js` - drops and recreates old 3-table structure
- `scripts/create-test-rook.js` - uses old INSERT INTO piece_movement pattern
- `scripts/fix-foreign-keys.js` - manages FKs for old tables
- `scripts/check-tables.js` - checks old table structure

### Migration Code (Keep but mark as legacy)
- `server/migrations.js` lines 96-173 - CREATE TABLE piece_movement and piece_capture
- `server/migrations.js` lines 341-390 - Add UNIQUE constraints to old tables
- `server/migrations.js` lines 599-783 - Add columns to old tables

### Test Files
- `test-query.js` - can be deleted (temporary debugging file)

## 🔧 Optional: Drop Old Tables (AFTER BACKUP)

Once you've verified everything works correctly for a few days:

```sql
-- BACKUP FIRST!
-- CREATE BACKUP
CREATE TABLE piece_movement_backup LIKE piece_movement;
INSERT INTO piece_movement_backup SELECT * FROM piece_movement;

CREATE TABLE piece_capture_backup LIKE piece_capture;
INSERT INTO piece_capture_backup SELECT * FROM piece_capture;

-- Then drop (uncomment when ready)
-- DROP TABLE IF EXISTS piece_movement;
-- DROP TABLE IF EXISTS piece_capture;
```

## 📋 Verification Checklist

Before dropping old tables, verify:
- [ ] All games load correctly with piece data
- [ ] Piece creation works (admin panel)
- [ ] Piece editing works (admin panel)
- [ ] Movement validation works (pawns can move 1 and 2 squares on first move)
- [ ] Special scenarios work correctly (first-move-only moves)
- [ ] Run for at least 48 hours without issues
- [ ] Database backup completed

## 🎯 Known Issues Fixed
- ✅ Pawns can now move 2 squares on first move
- ✅ Backend validates special_scenario_moves
- ✅ Frontend shows correct blue/yellow dots for regular/first-move-only moves
- ✅ Pieces maintain movement ability after first move
