# Piece Placement Feature Documentation

## Overview
Added a comprehensive piece placement system to the Game Wizard (Step 5) that allows game creators to visually place pieces on the board during game creation/editing.

## Features Implemented

### 1. Step 5: Piece Placement (Step5PiecePlacement.js)
- **Interactive Board**: Visual representation of the game board with the same dimensions configured in Step 3
- **Right-Click Placement**: Right-click any square to add/edit/remove pieces
- **Visual Feedback**: 
  - Pieces display their selected image on the board
  - Small colored indicator shows which player owns each piece
  - Real-time piece count statistics by player
- **Data Storage**: Piece placements stored as JSON in `pieces_string` field

### 2. Piece Selector Modal (PieceSelector.js)
- **Search & Filter**: Real-time search by piece name, ID, or description
- **Piece Grid Display**: Shows all available pieces with:
  - Thumbnail image (or fallback letter icon)
  - Piece name
  - Piece ID
- **Player Assignment**: Dropdown to assign piece to specific player (1-N)
- **Image Selection**: Choose from multiple uploaded images for the selected piece
- **Remove Option**: Remove existing pieces from squares

### 3. Updated GameWizard
- Extended wizard from 4 to 5 steps
- Integrated Step5PiecePlacement into the workflow
- Maintains all existing functionality

### 4. Styling (gamewizard.module.scss)
- Modal overlay and content styles
- Responsive piece grid layout
- Board square hover effects
- Player indicator colors (8 unique colors for up to 8 players)
- Search input styling
- Image selection gallery

## Data Structure

### pieces_string Format
```json
{
  "row,col": {
    "piece_id": 123,
    "piece_name": "Knight",
    "player_id": 1,
    "image_url": "http://localhost:3001/uploads/pieces/knight.png"
  },
  "0,0": {
    "piece_id": 456,
    "piece_name": "Rook",
    "player_id": 1,
    "image_url": "http://localhost:3001/uploads/pieces/rook.png"
  }
}
```

**Key Format**: `"row,col"` - e.g., `"0,0"` for top-left square, `"7,7"` for bottom-right on 8x8 board

**Value Object**:
- `piece_id`: ID of the piece from the pieces table
- `piece_name`: Name of the piece (for display)
- `player_id`: Which player owns this piece (1-N)
- `image_url`: Selected image URL from available piece images

## User Workflow

1. **Navigate to Game Wizard**: Create new game or edit existing
2. **Complete Steps 1-4**: Basic info, win conditions, board setup, advanced settings
3. **Step 5 - Piece Placement**:
   - View board preview with configured dimensions
   - Right-click any square to open piece selector
   - Search for desired piece by name/ID
   - Select piece from grid
   - Assign to player
   - Choose image variant
   - Click "Confirm" to place piece
   - Repeat for all starting pieces
4. **Save Game**: Placements stored as JSON in database

## Technical Details

### Components Created
- `Step5PiecePlacement.js` - Main step component with board rendering
- `PieceSelector.js` - Modal for piece selection and configuration

### Files Modified
- `GameWizard.js` - Added Step 5 import and rendering
- `gamewizard.module.scss` - Added extensive styling for new components

### API Endpoints Used
- `GET /api/pieces` - Fetch all available pieces (existing endpoint)
- `POST /api/games` - Create game with pieces_string (already supports field)
- `PUT /api/games/:gameId` - Update game with pieces_string (already supports field)

### Database
- No schema changes needed
- Uses existing `pieces_string` VARCHAR(8000) field in `game_types` table
- Stores JSON string representation of piece placements

## Player Colors
```javascript
const colors = [
  '#ff6b6b',  // Player 1 - Red
  '#4ecdc4',  // Player 2 - Teal
  '#45b7d1',  // Player 3 - Blue
  '#f7dc6f',  // Player 4 - Yellow
  '#bb8fce',  // Player 5 - Purple
  '#52be80',  // Player 6 - Green
  '#ec7063',  // Player 7 - Coral
  '#5dade2'   // Player 8 - Sky Blue
];
```

## Future Enhancements (Optional)
- Drag & drop piece placement
- Copy/paste board configurations
- Symmetric piece placement (mirror pieces for other players)
- Save/load piece templates
- Preview game with placed pieces
- Validation (e.g., prevent duplicate pieces, enforce piece limits)

## Browser Compatibility
- Modern browsers supporting:
  - CSS Grid
  - ES6+ JavaScript
  - Context menu events (right-click)
  - JSON parsing

## Testing Checklist
- ✅ Create new game and place pieces
- ✅ Edit existing game and modify pieces
- ✅ Remove pieces from board
- ✅ Search/filter pieces
- ✅ Select different images for same piece type
- ✅ Assign pieces to different players
- ✅ Save and reload game to verify persistence
- ✅ Handle empty piece list gracefully
- ✅ Handle pieces without images
- ✅ Responsive design on different screen sizes
