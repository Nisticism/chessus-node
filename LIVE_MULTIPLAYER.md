# Live Multiplayer Game System

This document describes the real-time multiplayer game system implementation.

## Overview

The system allows two players to play against each other in real-time using WebSockets (Socket.io).

## Components

### Backend

1. **Socket.io Server** (`server/game-socket.js`)
   - Handles WebSocket connections
   - Manages game rooms
   - Broadcasts moves to players
   - Tracks game state in memory

2. **Database Migrations** (`server/migrations.js`)
   - Added `status` column to games table (waiting, ready, active, completed, cancelled)
   - Added `host_id` column to track game creator
   - Added `winner_id` column for completed games
   - Increased `other_data` and `pieces` columns to MEDIUMTEXT

### Frontend

1. **SocketContext** (`src/contexts/SocketContext.js`)
   - React context providing socket connection
   - Exposes methods: createGame, joinGame, makeMove, resign, etc.
   - Handles reconnection logic

2. **Play Page** (`src/containers/play/Play.js`)
   - Game lobby showing available game types
   - List of open matches waiting for players
   - Game creation modal with time control options

3. **LiveGame Component** (`src/components/livegame/LiveGame.js`)
   - Real-time game board
   - Player info and timers
   - Move history
   - Game over handling

## Game Flow

1. **Create Game**
   - Player selects a game type from sidebar
   - Clicks "Host Game" and configures time controls
   - Game is created with status "waiting"
   - Player waits in lobby or shares link

2. **Join Game**
   - Second player sees open match in lobby
   - Clicks "Join Game"
   - Players are randomly assigned positions (1 or 2)
   - Game status changes to "ready"

3. **Gameplay**
   - Player 1 makes the first move (starts the game)
   - Game status changes to "active"
   - Moves are validated and broadcast in real-time
   - Time is tracked per player (if time control enabled)

4. **Game End**
   - Win conditions checked after each move
   - Player can resign
   - Timeout (if using time control)
   - Game status changes to "completed"

## Socket Events

### Client → Server
- `authenticate` - Identify user after connection
- `getOpenGames` - Request list of waiting games
- `createGame` - Create a new game
- `joinGame` - Join an existing game
- `makeMove` - Submit a move
- `resign` - Forfeit the game
- `cancelGame` - Cancel a waiting game (host only)
- `getGameState` - Request current game state

### Server → Client
- `openGamesList` - List of available games
- `newOpenGame` - Broadcast when game created
- `gameRemoved` - Broadcast when game starts/cancels
- `gameCreated` - Confirmation to host
- `playerJoined` - Player joined notification
- `moveMade` - Move broadcast to all players
- `gameOver` - Game end notification
- `gameState` - Current game state
- `error` - Error messages

## Time Controls

Supported time formats:
- No limit (∞)
- 1 minute (Bullet)
- 3 minutes (Blitz)
- 5 minutes (Blitz)
- 10 minutes (Rapid)
- 15 minutes (Rapid)
- 30 minutes (Classical)
- 60 minutes (Classical)

Increment options: 0, 1, 2, 3, 5, 10 seconds per move

## Future Enhancements

- [ ] Full piece movement validation based on piece_movement table
- [ ] Spectator mode for watching games
- [ ] Rematch functionality
- [ ] Rating/ELO updates
- [ ] Game analysis after completion
- [ ] Mobile-optimized board
- [ ] Sound effects for moves
- [ ] Move animations
