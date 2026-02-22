/**
 * Fix SVG file extensions that were incorrectly saved as .svg+xml
 * 
 * This script:
 * 1. Finds all files in uploads/pieces with .svg+xml extension
 * 2. Renames them to .svg
 * 3. Updates the database paths in the pieces table
 * 
 * Run with: node scripts/fix-svg-extensions.js
 */

const fs = require('fs');
const path = require('path');
const db = require('../configs/db');

const uploadsDir = path.join(__dirname, '../uploads/pieces');

async function fixSvgExtensions() {
  console.log('Starting SVG extension fix...\n');
  
  // Step 1: Find and rename files
  const files = fs.readdirSync(uploadsDir);
  const badFiles = files.filter(f => f.endsWith('.svg+xml'));
  
  console.log(`Found ${badFiles.length} files with .svg+xml extension`);
  
  const renamedFiles = [];
  
  for (const oldName of badFiles) {
    const newName = oldName.replace('.svg+xml', '.svg');
    const oldPath = path.join(uploadsDir, oldName);
    const newPath = path.join(uploadsDir, newName);
    
    try {
      fs.renameSync(oldPath, newPath);
      renamedFiles.push({ oldName, newName });
      console.log(`  Renamed: ${oldName} -> ${newName}`);
    } catch (err) {
      console.error(`  Error renaming ${oldName}: ${err.message}`);
    }
  }
  
  console.log(`\nRenamed ${renamedFiles.length} files`);
  
  // Step 2: Update database paths
  console.log('\nUpdating database paths...');
  
  try {
    // Get all pieces that might have svg+xml paths
    const [pieces] = await db.query(
      `SELECT id, image_location FROM pieces WHERE image_location LIKE '%svg+xml%'`
    );
    
    console.log(`Found ${pieces.length} pieces with svg+xml in image_location`);
    
    for (const piece of pieces) {
      const oldLocation = piece.image_location;
      const newLocation = oldLocation.replace(/\.svg\+xml/g, '.svg');
      
      await db.query(
        `UPDATE pieces SET image_location = ? WHERE id = ?`,
        [newLocation, piece.id]
      );
      
      console.log(`  Updated piece ${piece.id}: ${oldLocation.substring(0, 50)}...`);
    }
    
    console.log(`\nUpdated ${pieces.length} database records`);
  } catch (err) {
    console.error('Database error:', err.message);
    console.log('Files were renamed but database was not updated.');
    console.log('You may need to manually update the database or run this on the production server.');
  } finally {
    await db.end();
  }
  
  console.log('\nDone!');
}

fixSvgExtensions().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
