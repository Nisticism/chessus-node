# Piece Wizard Setup Instructions

## Overview
The piece creation wizard has been implemented with a 4-step interface for creating custom chess pieces with image upload and interactive board preview.

## Required Dependencies

Install multer for file upload handling:

```bash
npm install multer
```

## Directory Structure

The following directory will be created automatically when you upload the first piece image:
- `uploads/pieces/` - Stores uploaded piece images

## Features Implemented

### 1. Multi-Step Wizard (PieceWizard.js)
- 4-step process with progress indicator
- Manages 87 piece properties from the pieces table
- FormData submission for multipart file upload
- Navigation between steps with validation

### 2. Step 1: Basic Info & Image Upload (PieceStep1BasicInfo.js)
- Image upload with drag-and-drop
- File validation (JPG, PNG, GIF, max 5MB)
- Image preview generation using FileReader
- Piece dimensions (width x height)
- Piece name and type

### 3. Step 2: Movement Configuration (PieceStep2Movement.js)
- **Directional Movement**: 8-directional movement values (up, down, left, right, diagonals)
  - Positive values = exact squares
  - Negative values = up to that many squares
  - 0 = no movement in that direction
- **Ratio Movement**: Knight-style L-shaped movement (e.g., 2-1)
- **Step-by-Step Movement**: Total squares the piece can move in any combination
- **Hopping**: Can hop over allies/enemies
- Live board preview showing movement patterns

### 4. Step 3: Attack Configuration (PieceStep3Attack.js)
- **Capture on Move**: Traditional capture by moving to enemy square
- **Ranged Attack**: Attack without moving
- **Directional Attack Ranges**: 8-directional attack values
- **Ratio Attack Range**: L-shaped attack pattern
- **Step-by-Step Attack**: Total attack range in any direction
- Live board preview showing attack patterns (red) and movement (blue)

### 5. Step 4: Special Rules & Review (PieceStep4Special.js)
- **Checkmate Rules**: Checkmate on attack, check on attack, causes check/checkmate
- **Loss Conditions**: Lose game if piece is captured
- **Movement Restrictions**: Minimum turns before piece can move
- **Special Scenarios**: JSON fields for complex custom rules
- **Summary Section**: Review all configured settings before submission

### 6. Interactive Board Preview (PieceBoardPreview.js)
- 9x9 grid with piece centered at (4, 4)
- Hover to highlight valid squares:
  - **Blue**: Movement squares
  - **Red**: Attack squares
  - **Purple**: Both movement and attack
- Calculates based on current wizard settings
- Updates in real-time as you configure movement/attack

## Backend Implementation

### API Endpoint
**POST** `/api/pieces/create`
- Uses multer middleware for image upload
- Stores images in `/uploads/pieces/`
- Validates file type and size
- Returns piece ID and image path

### Database
Inserts into the `pieces` table with all 87 fields including:
- Basic info (name, type, dimensions, image path)
- Movement settings (directional, ratio, step-by-step)
- Attack settings (capture, ranged attack, ranges)
- Special rules (checkmate, check, loss conditions)

## Frontend Updates

### Actions (actions/pieces.js)
Added `createPiece` action that sends FormData to the API

### Services (services/pieces.service.js)
Added `createPiece` service with multipart/form-data header

### Container (containers/piececreate/PieceCreate.js)
Renders the PieceWizard component

## Usage

1. Navigate to the piece creation page
2. **Step 1**: Upload a piece image and enter basic info
3. **Step 2**: Configure how the piece moves
4. **Step 3**: Configure how the piece attacks/captures
5. **Step 4**: Set special rules and review
6. Click "Create Piece" to submit

## Preview Legend

When viewing the board preview:
- **Light squares**: Default board color
- **Dark squares**: Alternating board color
- **Blue highlighted**: Squares the piece can move to
- **Red highlighted**: Squares the piece can attack
- **Purple highlighted**: Squares with both movement and attack
- **Green border**: Current piece position

## Notes

- All boolean fields default to `false`
- All numeric fields default to `0` or `null`
- Movement/attack values: 
  - `0` = disabled
  - Positive = exact squares
  - Negative = up to that many squares
- Image uploads are required
- Maximum file size: 5MB
- Supported formats: JPG, PNG, GIF

## File Locations

### Frontend Components:
- `GRIDGROVE-frontend/src/components/piecewizard/PieceWizard.js`
- `GRIDGROVE-frontend/src/components/piecewizard/PieceStep1BasicInfo.js`
- `GRIDGROVE-frontend/src/components/piecewizard/PieceStep2Movement.js`
- `GRIDGROVE-frontend/src/components/piecewizard/PieceStep3Attack.js`
- `GRIDGROVE-frontend/src/components/piecewizard/PieceStep4Special.js`
- `GRIDGROVE-frontend/src/components/piecewizard/PieceBoardPreview.js`
- `GRIDGROVE-frontend/src/components/piecewizard/piecewizard.module.scss`

### Frontend Services:
- `GRIDGROVE-frontend/src/actions/pieces.js`
- `GRIDGROVE-frontend/src/services/pieces.service.js`
- `GRIDGROVE-frontend/src/containers/piececreate/PieceCreate.js`

### Backend:
- `server/index.js` (POST `/api/pieces/create` endpoint)
