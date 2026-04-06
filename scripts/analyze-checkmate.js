#!/usr/bin/env node
/**
 * Checkmate Analysis Script
 * 
 * Loads a game from the database and replays it position by position,
 * checking for undetected checkmate at each turn.
 * 
 * Usage:
 *   node scripts/analyze-checkmate.js [gameId]
 *   node scripts/analyze-checkmate.js --latest-bot
 * 
 * If no gameId is given, defaults to --latest-bot (most recent completed bot game).
 */

const db_pool = require('../configs/db');
const gameSocket = require('../server/game-socket');

// Import the actual game logic functions used by the server
const {
  getPossibleMovesForPiece,
  getAllLegalMovesForPlayer,
  checkForCheck,
  isCheckmate,
  wouldMoveLeaveInCheck,
  findPieceAtSquare,
  doesPieceOccupySquare
} = gameSocket;

// ── Helpers ────────────────────────────────────────────────────────────

function printBoard(pieces, boardWidth, boardHeight) {
  const grid = [];
  for (let y = 0; y < boardHeight; y++) {
    const row = [];
    for (let x = 0; x < boardWidth; x++) {
      row.push('  .  ');
    }
    grid.push(row);
  }

  for (const p of pieces) {
    const owner = p.team || p.player_id;
    const label = (p.piece_name || '??').substring(0, 3);
    const marker = owner === 1 ? `[${label}]` : `(${label})`;
    const pw = p.piece_width || 1;
    const ph = p.piece_height || 1;
    for (let dy = 0; dy < ph; dy++) {
      for (let dx = 0; dx < pw; dx++) {
        const gx = p.x + dx;
        const gy = p.y + dy;
        if (gx >= 0 && gx < boardWidth && gy >= 0 && gy < boardHeight) {
          grid[gy][gx] = marker.padStart(5);
        }
      }
    }
  }

  // Column headers
  let header = '     ';
  for (let x = 0; x < boardWidth; x++) header += String(x).padStart(5);
  console.log(header);
  for (let y = 0; y < boardHeight; y++) {
    console.log(String(y).padStart(3) + '  ' + grid[y].join(''));
  }
  console.log('  [XXX] = Player 1     (XXX) = Player 2');
}

function describeAttack(attacker, targetX, targetY) {
  const dx = targetX - attacker.x;
  const dy = targetY - attacker.y;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  if (absDx === absDy) return `diagonal (dx=${dx}, dy=${dy})`;
  if (dx === 0) return `vertical (dy=${dy})`;
  if (dy === 0) return `horizontal (dx=${dx})`;
  return `ratio/L-shape (dx=${dx}, dy=${dy})`;
}

// ── Core analysis ──────────────────────────────────────────────────────

// Suppress verbose debug logging from game-socket functions during analysis
const originalLog = console.log;
function suppressLogs() {
  console.log = (...args) => {
    // Only suppress game-socket debug noise
    const firstArg = String(args[0] || '');
    if (firstArg.includes('Ratio movement') ||
        firstArg.includes('Allowing hop') ||
        firstArg.includes('No hopping') ||
        firstArg.includes('Move would leave') ||
        firstArg.includes('Getting legal moves') ||
        firstArg.includes('Sample pieces') ||
        firstArg.includes('Legal move found') ||
        firstArg.includes('Checkmate check') ||
        firstArg.includes('=== CHECKMATE') ||
        firstArg.includes('=== END CHECKMATE') ||
        firstArg.includes('NOT checkmate') ||
        firstArg.includes('CHECKMATE DETECTED') ||
        firstArg.startsWith('Player') ||
        firstArg.startsWith('  ') ||
        firstArg.includes('Checked pieces') ||
        firstArg.includes('Legal moves found') ||
        firstArg.includes('After sim') ||
        firstArg.includes('INCONSISTENCY') ||
        firstArg.includes('Would capture')) {
      return; // Suppress
    }
    originalLog.apply(console, args);
  };
}
function restoreLogs() {
  console.log = originalLog;
}

function buildAttackerInfo(enemy) {
  return {
    id: enemy.id,
    name: enemy.piece_name,
    x: enemy.x,
    y: enemy.y,
    player: enemy.team || enemy.player_id
  };
}

function analyzePositionForCheckmate(pieces, gameType, turnPlayerPosition) {
  // Build a gameState-like object the exported functions expect
  suppressLogs();
  const gameState = {
    pieces: pieces.map(p => ({ ...p })),
    gameType
  };

  const checkResult = checkForCheck(gameState, turnPlayerPosition);

  if (!checkResult.inCheck) {
    return { inCheck: false };
  }

  // In check – enumerate legal moves
  const legalMoves = getAllLegalMovesForPlayer(gameState, turnPlayerPosition);
  const isCheckmateResult = legalMoves.length === 0;

  // Build detailed analysis
  const analysis = {
    inCheck: true,
    isCheckmate: isCheckmateResult,
    checkedPieces: checkResult.checkedPieces.map(p => ({
      id: p.id,
      name: p.piece_name,
      x: p.x,
      y: p.y
    })),
    legalMoveCount: legalMoves.length,
    legalMoves: [],
    attackDetails: []
  };

  // For each checkmate piece, show what's attacking it (using full piece set for accurate path checking)
  for (const king of checkResult.checkedPieces) {
    const kingOwner = king.team || king.player_id;
    const enemies = pieces.filter(p => {
      const o = p.team || p.player_id;
      return o !== kingOwner;
    });
    for (const enemy of enemies) {
      // Use full piece set so path-blocking checks work correctly
      const fullState = { pieces: [...pieces], gameType };
      const fullCheck = checkForCheck(fullState, kingOwner);
      // Verify this specific enemy is contributing: remove it and see if check goes away
      const withoutEnemy = { pieces: pieces.filter(p => p.id !== enemy.id), gameType };
      const checkWithout = checkForCheck(withoutEnemy, kingOwner);
      if (fullCheck.inCheck && !checkWithout.inCheck) {
        // This enemy is the sole checker
        analysis.attackDetails.push({
          attacker: buildAttackerInfo(enemy),
          target: { id: king.id, name: king.piece_name, x: king.x, y: king.y },
          attackType: describeAttack(enemy, king.x, king.y)
        });
      } else if (fullCheck.inCheck && checkWithout.inCheck) {
        // Multiple checkers — verify this one contributes by testing with only this enemy + king
        // but using full board for path blocking
        const piecesWithoutOtherEnemies = pieces.filter(p => {
          const o = p.team || p.player_id;
          return o === kingOwner || p.id === enemy.id;
        });
        const singleEnemyCheck = checkForCheck({ pieces: piecesWithoutOtherEnemies, gameType }, kingOwner);
        if (singleEnemyCheck.inCheck) {
          analysis.attackDetails.push({
            attacker: buildAttackerInfo(enemy),
            target: { id: king.id, name: king.piece_name, x: king.x, y: king.y },
            attackType: describeAttack(enemy, king.x, king.y)
          });
        }
      }
    }
  }

  // Show each "legal" escape move with detailed reasoning
  for (const m of legalMoves.slice(0, 20)) {
    const movingPiece = pieces.find(p => p.id === m.pieceId);
    const moveInfo = {
      piece: movingPiece?.piece_name || '??',
      pieceId: m.pieceId,
      from: m.from,
      to: m.to,
      threatsAtDestination: []
    };

    // Simulate this move and find what SHOULD threaten the king at the new position
    const simPieces = pieces.map(p => ({ ...p }));
    const simMoving = simPieces.find(p => p.id === m.pieceId);
    // Remove captured piece at destination
    const capturedIdx = simPieces.findIndex(p =>
      p.id !== m.pieceId && doesPieceOccupySquare(p, m.to.x, m.to.y)
    );
    let capturedPiece = null;
    if (capturedIdx !== -1) {
      capturedPiece = simPieces[capturedIdx];
      simPieces.splice(capturedIdx, 1);
    }
    // Move the piece
    const simMovingAfter = simPieces.find(p => p.id === m.pieceId);
    if (simMovingAfter) {
      simMovingAfter.x = m.to.x;
      simMovingAfter.y = m.to.y;
    }
    moveInfo.capturedPiece = capturedPiece ? { name: capturedPiece.piece_name, x: capturedPiece.x, y: capturedPiece.y } : null;

    // After simulating, check if king is STILL in check (should match wouldMoveLeaveInCheck)
    const simState = { pieces: simPieces, gameType };
    const simCheck = checkForCheck(simState, movingPiece?.team || movingPiece?.player_id);
    moveInfo.stillInCheckAfterSim = simCheck.inCheck;

    // Also run the actual wouldMoveLeaveInCheck to compare
    const fullGameState = { pieces: pieces.map(p => ({ ...p })), gameType };
    const wouldLeave = wouldMoveLeaveInCheck(fullGameState, m, movingPiece?.team || movingPiece?.player_id);
    moveInfo.wouldMoveLeaveInCheck = wouldLeave;

    // INCONSISTENCY detection
    if (simCheck.inCheck !== wouldLeave) {
      moveInfo.INCONSISTENCY = true;
      moveInfo.note = `checkForCheck says ${simCheck.inCheck ? 'IN CHECK' : 'SAFE'} but wouldMoveLeaveInCheck says ${wouldLeave ? 'LEAVES IN CHECK' : 'SAFE'}`;
    }

    // Check each enemy's ability to attack the king squares after this move
    const kingOwner = movingPiece?.team || movingPiece?.player_id;
    const kings = simPieces.filter(p => {
      const o = p.team || p.player_id;
      return o === kingOwner && p.ends_game_on_checkmate;
    });
    const enemies = simPieces.filter(p => {
      const o = p.team || p.player_id;
      return o !== kingOwner;
    });

    for (const king of kings) {
      for (const enemy of enemies) {
        // Use full simulated board (not mini-state) so path blocking is accurate
        const withoutEnemy = { pieces: simPieces.filter(p => p.id !== enemy.id), gameType };
        const fullSimCheck = checkForCheck({ pieces: [...simPieces], gameType }, kingOwner);
        const checkWithout = checkForCheck(withoutEnemy, kingOwner);
        // This enemy contributes to check if removing it changes the result
        const contributes = fullSimCheck.inCheck && (!checkWithout.inCheck || (() => {
          // Multiple checkers: test with only friendly pieces + this enemy
          const solo = simPieces.filter(p => (p.team || p.player_id) === kingOwner || p.id === enemy.id);
          return checkForCheck({ pieces: solo, gameType }, kingOwner).inCheck;
        })());
        if (contributes) {
          moveInfo.threatsAtDestination.push({
            attacker: `${enemy.piece_name} (${enemy.x},${enemy.y})`,
            attackType: describeAttack(enemy, king.x, king.y)
          });
        }
      }
    }

    analysis.legalMoves.push(moveInfo);
  }

  restoreLogs();
  return analysis;
}

// ── Move replay helper ─────────────────────────────────────────────────

function applyMove(pieces, move) {
  // Simple move application: move piece, remove captured piece at destination
  const { pieceId, from, to } = move;
  const piece = pieces.find(p => p.id === pieceId);
  if (!piece) return;

  // If move was cancelled (HP/AD: enemy survived at destination), piece stays put
  if (move.moveCancelled) {
    // Still apply damage / remove killed pieces if any
    if (move.captured) {
      const capIdx = pieces.findIndex(p => p.id === move.captured.id);
      if (capIdx !== -1) pieces.splice(capIdx, 1);
    }
    piece.hasMoved = true;
    piece.moveCount = (piece.moveCount || 0) + 1;
    return;
  }

  // Remove enemy at destination
  const capturedIdx = pieces.findIndex(p =>
    p.id !== pieceId && doesPieceOccupySquare(p, to.x, to.y)
  );
  if (capturedIdx !== -1) {
    const captured = pieces[capturedIdx];
    const capturedOwner = captured.team || captured.player_id;
    const pieceOwner = piece.team || piece.player_id;
    if (capturedOwner !== pieceOwner) {
      // HP/AD: check if attack is lethal
      const ad = piece.attack_damage || 1;
      const hp = captured.current_hp ?? captured.hit_points ?? 1;
      if (ad >= hp && !captured.cannot_be_captured) {
        pieces.splice(capturedIdx, 1);
      }
    }
  }

  // Move piece
  const movingPiece = pieces.find(p => p.id === pieceId);
  if (movingPiece) {
    movingPiece.x = to.x;
    movingPiece.y = to.y;
    movingPiece.hasMoved = true;
    movingPiece.moveCount = (movingPiece.moveCount || 0) + 1;
  }

  // Handle castling — move the partner piece
  if (move.isCastling && move.castlingWith && move.castlingDirection) {
    const castlingPartner = pieces.find(p => p.id === move.castlingWith);
    if (castlingPartner) {
      if (move.castlingDirection === 'left') {
        castlingPartner.x = to.x + 1;
        castlingPartner.y = to.y;
      } else {
        castlingPartner.x = to.x - 1;
        castlingPartner.y = to.y;
      }
      castlingPartner.hasMoved = true;
      castlingPartner.moveCount = (castlingPartner.moveCount || 0) + 1;
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  let gameId = null;

  if (args.length > 0 && args[0] !== '--latest-bot') {
    gameId = parseInt(args[0], 10);
    if (isNaN(gameId)) {
      console.error('Invalid game ID:', args[0]);
      process.exit(1);
    }
  }

  try {
    let gameRow;
    if (gameId) {
      const [rows] = await db_pool.query(
        'SELECT g.*, gt.board_width, gt.board_height, gt.mate_condition, gt.mate_piece, gt.game_name as game_type_name FROM games g INNER JOIN game_types gt ON g.game_type_id = gt.id WHERE g.id = ?',
        [gameId]
      );
      gameRow = rows[0];
    } else {
      // Find most recent bot game
      const [rows] = await db_pool.query(
        `SELECT g.*, gt.board_width, gt.board_height, gt.mate_condition, gt.mate_piece, gt.game_name as game_type_name
         FROM games g
         INNER JOIN game_types gt ON g.game_type_id = gt.id
         WHERE g.other_data LIKE '%"isBotGame":true%'
         ORDER BY g.id DESC LIMIT 1`
      );
      gameRow = rows[0];
    }

    if (!gameRow) {
      console.error('No game found.');
      process.exit(1);
    }

    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`ANALYZING GAME #${gameRow.id} — "${gameRow.game_type_name}"`);
    console.log(`Board: ${gameRow.board_width}x${gameRow.board_height}  |  Mate condition: ${gameRow.mate_condition ? 'YES' : 'NO'}`);
    console.log(`Status: ${gameRow.status}  |  Winner: ${gameRow.winner_id || 'none'}`);
    console.log('═══════════════════════════════════════════════════════════════');

    // Parse stored data
    let finalPieces = [];
    let otherData = {};
    try {
      finalPieces = typeof gameRow.pieces === 'string' ? JSON.parse(gameRow.pieces) : gameRow.pieces;
    } catch (e) {
      console.error('Failed to parse pieces JSON:', e.message);
      process.exit(1);
    }
    try {
      otherData = typeof gameRow.other_data === 'string' ? JSON.parse(gameRow.other_data) : gameRow.other_data;
    } catch (e) {
      console.error('Failed to parse other_data JSON:', e.message);
    }

    const moveHistory = otherData.moves || [];
    const initialPieces = otherData.initialPieces || null;
    const gameType = {
      board_width: gameRow.board_width || 8,
      board_height: gameRow.board_height || 8,
      mate_condition: !!gameRow.mate_condition,
      mate_piece: gameRow.mate_piece
    };

    console.log(`\nMove history: ${moveHistory.length} moves recorded`);
    console.log(`Initial pieces snapshot: ${initialPieces ? 'YES' : 'NO'}`);

    if (!initialPieces || initialPieces.length === 0) {
      console.log('\n⚠ No initial pieces snapshot. Analyzing FINAL position only.\n');
      console.log('FINAL BOARD STATE:');
      printBoard(finalPieces, gameType.board_width, gameType.board_height);

      // Analyze each player
      for (const player of [1, 2]) {
        console.log(`\n─── Check/Checkmate analysis for Player ${player} ───`);
        const result = analyzePositionForCheckmate(finalPieces, gameType, player);
        printAnalysis(result, player);
      }
    } else {
      // Replay move by move
      const pieces = initialPieces.map(p => ({ ...p }));
      let currentTurn = 1; // Player 1 goes first

      console.log('\n─── INITIAL POSITION ───');
      printBoard(pieces, gameType.board_width, gameType.board_height);

      let checkmateFound = false;
      for (let i = 0; i < moveHistory.length; i++) {
        const move = moveHistory[i];
        const movingPiece = pieces.find(p => p.id === move.pieceId);
        const moverName = movingPiece?.piece_name || '??';
        const moverOwner = movingPiece?.team || movingPiece?.player_id;

        // Apply the move
        applyMove(pieces, move);

        // After each move, check the OPPONENT for check/checkmate
        const opponent = moverOwner === 1 ? 2 : 1;
        suppressLogs();
        const checkResult = checkForCheck({ pieces, gameType }, opponent);
        restoreLogs();

        if (checkResult.inCheck) {
          console.log(`\n═══ MOVE ${i + 1}: ${moverName} (P${moverOwner}) ${move.from.x},${move.from.y} → ${move.to.x},${move.to.y} ═══`);
          console.log(`*** Player ${opponent} is in CHECK! ***`);
          printBoard(pieces, gameType.board_width, gameType.board_height);

          const result = analyzePositionForCheckmate(pieces, gameType, opponent);
          printAnalysis(result, opponent);

          if (result.isCheckmate) {
            console.log(`\n🔴 CHECKMATE at move ${i + 1}!`);
            if (i < moveHistory.length - 1) {
              console.log(`   ⚠ But the game continued for ${moveHistory.length - i - 1} more moves — CHECKMATE WAS MISSED!`);
            }
            checkmateFound = true;
          }
        }
      }

      if (!checkmateFound) {
        // Analyze the final position too
        console.log('\n─── FINAL POSITION (after all moves) ───');
        printBoard(pieces, gameType.board_width, gameType.board_height);
        for (const player of [1, 2]) {
          const result = analyzePositionForCheckmate(pieces, gameType, player);
          if (result.inCheck) {
            console.log(`\nPlayer ${player} is in CHECK at final position:`);
            printAnalysis(result, player);
          }
        }
      }
    }

    // Also show the attacking piece's full movement data for the combo piece
    console.log('\n─── PIECE MOVEMENT DATA (pieces with both diagonal and ratio) ───');
    const allPieces = initialPieces || finalPieces;
    for (const p of allPieces) {
      const hasDiag = p.up_left_capture || p.up_right_capture || p.down_left_capture || p.down_right_capture ||
                      p.up_left_movement || p.up_right_movement || p.down_left_movement || p.down_right_movement;
      const hasRatio = (p.ratio_capture_1 && p.ratio_capture_2) ||
                       (p.ratio_movement_1 && p.ratio_movement_2);
      if (hasDiag && hasRatio) {
        console.log(`\n  ${p.piece_name} (id=${p.id}, player=${p.team || p.player_id}):`);
        console.log(`    Diagonal captures: UL=${p.up_left_capture} UR=${p.up_right_capture} DL=${p.down_left_capture} DR=${p.down_right_capture}`);
        console.log(`    Diagonal moves:    UL=${p.up_left_movement} UR=${p.up_right_movement} DL=${p.down_left_movement} DR=${p.down_right_movement}`);
        console.log(`    Ratio capture:     ${p.ratio_capture_1}:${p.ratio_capture_2}`);
        console.log(`    Ratio movement:    ${p.ratio_movement_1}:${p.ratio_movement_2}`);
        console.log(`    attacks_like_movement: ${p.attacks_like_movement}  can_capture_enemy_on_move: ${p.can_capture_enemy_on_move}`);
        console.log(`    can_hop_over_allies: ${p.can_hop_over_allies}  can_hop_over_enemies: ${p.can_hop_over_enemies}`);
        console.log(`    can_hop_attack_over_allies: ${p.can_hop_attack_over_allies}  can_hop_attack_over_enemies: ${p.can_hop_attack_over_enemies}`);
        console.log(`    ghostwalk: ${p.ghostwalk}  repeating_ratio: ${p.repeating_ratio}  repeating_ratio_capture: ${p.repeating_ratio_capture}`);
      }
    }

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await db_pool.end();
  }
}

function printAnalysis(result, player) {
  if (!result.inCheck) {
    console.log(`  Player ${player}: NOT in check.`);
    return;
  }

  console.log(`  Checked pieces:`);
  for (const cp of result.checkedPieces) {
    console.log(`    ${cp.name} at (${cp.x},${cp.y})`);
  }

  if (result.attackDetails.length > 0) {
    console.log(`  Attacking pieces:`);
    for (const ad of result.attackDetails) {
      console.log(`    ${ad.attacker.name} at (${ad.attacker.x},${ad.attacker.y}) via ${ad.attackType}`);
    }
  }

  if (result.isCheckmate) {
    console.log(`  RESULT: CHECKMATE — no legal moves available.`);
  } else {
    console.log(`  RESULT: CHECK — ${result.legalMoveCount} escape move(s) found:`);
    for (const m of result.legalMoves) {
      const inconsistency = m.INCONSISTENCY ? ' *** INCONSISTENCY ***' : '';
      const inCheckAfter = m.stillInCheckAfterSim ? ' [STILL IN CHECK!]' : ' [safe]';
      const wouldLeave = m.wouldMoveLeaveInCheck ? ' [wouldLeave=true]' : ' [wouldLeave=false]';
      console.log(`    ${m.piece} (${m.from.x},${m.from.y}) → (${m.to.x},${m.to.y})${inCheckAfter}${wouldLeave}${inconsistency}`);
      if (m.capturedPiece) {
        console.log(`      Captures: ${m.capturedPiece.name} at (${m.capturedPiece.x},${m.capturedPiece.y})`);
      }
      if (m.INCONSISTENCY) {
        console.log(`      NOTE: ${m.note}`);
      }
      if (m.threatsAtDestination.length > 0) {
        console.log(`      Threats after move:`);
        for (const t of m.threatsAtDestination) {
          console.log(`        ${t.attacker} via ${t.attackType}`);
        }
      }
    }
  }
}

main();
