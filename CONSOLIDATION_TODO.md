# Piece Table Consolidation - Remaining Updates Needed

After the migration runs and consolidates piece_movement and piece_capture into pieces table, the following code still needs updating:

## server/index.js

### 1. Piece Edit Endpoint (Lines ~2318-2640)
Currently has 3 separate queries:
- UPDATE pieces (basic fields only)
- INSERT INTO piece_movement ... ON DUPLICATE KEY UPDATE
- INSERT INTO piece_capture ... ON DUPLICATE KEY UPDATE

**Should be:** Single UPDATE pieces statement with all fields

### 2. Piece GET endpoint (Line ~2744-2750)
Currently has JOINs:
```sql
LEFT JOIN piece_movement pm ON p.id = pm.piece_id
LEFT JOIN piece_capture pc ON p.id = pc.piece_id
```

**Should be:** Just `SELECT * FROM pieces WHERE ...`

### 3. Any UPDATE piece_movement or UPDATE piece_capture calls (Lines ~2951, 2960)
Should be UPDATE pieces instead

## Migration Complete Status

✅ Migration script created (db/migrations/consolidate-piece-tables.sql)
✅ Migration runner added to server/migrations.js  
✅ game-socket.js queries updated (3 locations - now use SELECT * FROM pieces)
✅ Piece CREATE endpoint updated (single INSERT into pieces)
❌ Piece EDIT endpoint needs update (still uses 3 statements)
❌ Piece GET endpoints need update (still use JOINs)

## Testing After Full Update

1. Restart backend (migration runs automatically)
2. Check backend logs for "✓ Consolidated piece tables"
3. Create a new piece - should work with consolidated table
4. Edit an existing piece - should work
5. Create a live game - pawns should have 2-square first move
6. Verify hover helpers show correct movements

## Notes

The migration keeps piece_movement and piece_capture tables intact (just commented out the DROP statements for safety). Once you verify everything works, you can manually drop them:

```sql
DROP TABLE IF EXISTS piece_movement;
DROP TABLE IF EXISTS piece_capture;
```
