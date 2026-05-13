#!/usr/bin/env node
/**
 * Threat / Capture Analysis Script
 *
 * Replays a game move-by-move and reports every significant exchange:
 *   - Losing bot captures (SEE < -0.5)
 *   - Bot pieces captured while undefended (could have escaped)
 *   - Bot pieces captured in a bad exchange (opponent wins SEE)
 *   - Bot pieces left hanging after each bot move
 *
 * Usage:
 *   node scripts/analyze-threats.js <gameId>
 *   node scripts/analyze-threats.js 484
 */

require('dotenv').config();
const db_pool = require('../configs/db');
const gs = require('../server/game-socket');
const { getPieceValue, getAttackersTo, staticExchangeEval } = require('../server/ai/ai-engine');
const { doesPieceOccupySquare, getAllLegalMovesForPlayer } = gs;

// ── Console suppression ───────────────────────────────────────────────
const _origLog = console.log;
function suppressLogs() { console.log = () => {}; }
function restoreLogs()  { console.log = _origLog; }

// ── Move replay (mirrors analyze-checkmate.js applyMove) ─────────────
function applyMove(pieces, move) {
  const { pieceId, to } = move;
  const piece = pieces.find(p => p.id === pieceId);
  if (!piece) return null;

  let capturedPiece = null;

  if (move.moveCancelled) {
    if (move.captured) {
      const capIdx = pieces.findIndex(p => p.id === move.captured.id);
      if (capIdx !== -1) { capturedPiece = pieces.splice(capIdx, 1)[0]; }
    }
    piece.hasMoved = true;
    piece.moveCount = (piece.moveCount || 0) + 1;
    return capturedPiece;
  }

  const capturedIdx = pieces.findIndex(p =>
    p.id !== pieceId && doesPieceOccupySquare(p, to.x, to.y)
  );
  if (capturedIdx !== -1) {
    const cap = pieces[capturedIdx];
    const capOwner = cap.team || cap.player_id;
    const pieceOwner = piece.team || piece.player_id;
    if (capOwner !== pieceOwner) {
      const ad = piece.attack_damage || 1;
      const hp = cap.current_hp ?? cap.hit_points ?? 1;
      if (ad >= hp && !cap.cannot_be_captured) {
        capturedPiece = pieces.splice(capturedIdx, 1)[0];
      }
    }
  }

  const mp = pieces.find(p => p.id === pieceId);
  if (mp) {
    mp.x = to.x; mp.y = to.y;
    mp.hasMoved = true;
    mp.moveCount = (mp.moveCount || 0) + 1;
  }

  if (move.isCastling && move.castlingWith && move.castlingDirection) {
    const partner = pieces.find(p => p.id === move.castlingWith);
    if (partner) {
      partner.x = move.castlingDirection === 'left' ? to.x + 1 : to.x - 1;
      partner.y = to.y;
      partner.hasMoved = true;
    }
  }

  return capturedPiece;
}

function fmt(v) { return typeof v === 'number' ? v.toFixed(2) : String(v); }

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  const gameId = parseInt(process.argv[2], 10);
  if (isNaN(gameId)) {
    console.error('Usage: node scripts/analyze-threats.js <gameId>');
    process.exit(1);
  }

  const [rows] = await db_pool.query(
    `SELECT g.*, gt.board_width, gt.board_height, gt.mate_condition,
            gt.capture_condition, gt.game_name as game_type_name
     FROM games g INNER JOIN game_types gt ON g.game_type_id = gt.id WHERE g.id = ?`,
    [gameId]
  );
  const gameRow = rows[0];
  if (!gameRow) { console.error('Game not found:', gameId); process.exit(1); }

  const otherData = JSON.parse(gameRow.other_data || '{}');
  const moves = otherData.moves || [];
  const initialPieces = otherData.initialPieces;

  if (!initialPieces || initialPieces.length === 0) {
    console.error('[ERR] No initialPieces snapshot stored in other_data for this game.');
    console.error('      Cannot replay. Try a more recent game.');
    process.exit(1);
  }

  const gameType = {
    board_width:  gameRow.board_width  || 10,
    board_height: gameRow.board_height || 8,
    mate_condition:    !!gameRow.mate_condition,
    capture_condition: !!gameRow.capture_condition,
  };
  const bs = Math.max(gameType.board_width, gameType.board_height);

  const isBotGame = otherData.isBotGame || false;
  const botPlayer = otherData.botPlayer || 2;
  const humanPlayer = botPlayer === 1 ? 2 : 1;

  console.log('=================================================================');
  console.log(`THREAT/CAPTURE ANALYSIS: Game #${gameId} -- "${gameRow.game_type_name}"`);
  console.log(`Board: ${gameType.board_width}x${gameType.board_height}  |  Moves: ${moves.length}`);
  console.log(`Bot game: ${isBotGame}  |  Bot = Player ${botPlayer}`);
  console.log('=================================================================\n');

  const pieces = initialPieces.map(p => ({ ...p }));
  let issues = 0;
  let botLosses = 0, botBadCaptures = 0, hangingAfterMove = 0;

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    const mover = pieces.find(p => p.id === move.pieceId);
    if (!mover) { applyMove(pieces, move); continue; }

    const moverOwner = mover.team || mover.player_id;
    const moverName  = mover.piece_name || '??';
    const moverVal   = getPieceValue(mover, bs);
    const moveNum    = i + 1;
    const side       = moverOwner === botPlayer ? 'BOT' : 'HUMAN';

    // ------------------------------------------------------------------
    // 1. Analyse the capture BEFORE applying the move
    // ------------------------------------------------------------------
    const target = pieces.find(p =>
      p.id !== move.pieceId && doesPieceOccupySquare(p, move.to.x, move.to.y)
    );
    const isCapture = !!(target && (target.team || target.player_id) !== moverOwner);

    if (isCapture) {
      const targetVal  = getPieceValue(target, bs);
      const targetName = target.piece_name || '??';
      const stateSnap  = { pieces: pieces.map(p => ({...p})), gameType };

      const see = staticExchangeEval(
        stateSnap, move.to.x, move.to.y,
        mover.id, moverVal, targetVal, moverOwner, bs
      );

      // A. Bot made a losing capture
      if (moverOwner === botPlayer && see < -0.5) {
        issues++;
        botBadCaptures++;
        console.log(`[LOSING BOT CAPTURE] Move ${moveNum}`);
        console.log(`  ${moverName} (val=${fmt(moverVal)}) x ${targetName} (val=${fmt(targetVal)}) at (${move.to.x},${move.to.y})`);
        console.log(`  SEE = ${fmt(see)}  (bot loses this trade)`);
        const defenders = getAttackersTo(stateSnap, move.to.x, move.to.y, humanPlayer, bs);
        if (defenders.length > 0) {
          console.log(`  Defenders of target square:`);
          for (const d of defenders) {
            console.log(`    - ${d.piece.piece_name} at (${d.piece.x},${d.piece.y}) val=${fmt(d.value)}`);
          }
        } else {
          console.log(`  [WARN] SEE negative but no defenders found -- possible SEE bug or piece has special captures`);
        }
        console.log('');
      }

      // B. Human captured a bot piece — was it undefended?
      if (moverOwner === humanPlayer && (target.team || target.player_id) === botPlayer) {
        const stateBeforeCapture = { pieces: pieces.map(p => ({...p})), gameType };
        const botDefenders = getAttackersTo(stateBeforeCapture, target.x, target.y, botPlayer, bs)
          .filter(a => a.piece.id !== target.id);

        if (botDefenders.length === 0) {
          issues++;
          botLosses++;
          console.log(`[BOT PIECE LOST -- UNDEFENDED] Move ${moveNum}`);
          console.log(`  Human's ${moverName} (val=${fmt(moverVal)}) captures bot's ${targetName} (val=${fmt(targetVal)}) at (${target.x},${target.y})`);
          console.log(`  Bot piece had 0 defenders.`);

          // Could the bot piece have escaped last turn?
          suppressLogs();
          try {
            const escapeMoves = getAllLegalMovesForPlayer(stateBeforeCapture, botPlayer)
              .filter(m => m.pieceId === target.id);
            restoreLogs();
            if (escapeMoves.length > 0) {
              console.log(`  Bot piece HAD ${escapeMoves.length} escape move(s) on previous turn -- should have retreated!`);
            } else {
              console.log(`  Bot piece had no legal escape moves (was trapped).`);
            }
          } catch (e) {
            restoreLogs();
            console.log(`  (Could not compute escape moves: ${e.message})`);
          }
          console.log('');
        } else {
          // Bot piece was defended but human still made it -- was it a good trade for human?
          const humanSEE = staticExchangeEval(
            stateBeforeCapture, target.x, target.y,
            mover.id, moverVal, targetVal, humanPlayer, bs
          );
          if (humanSEE > 0.5) {
            issues++;
            botLosses++;
            console.log(`[BOT PIECE LOST -- BAD EXCHANGE] Move ${moveNum}`);
            console.log(`  Human's ${moverName} (val=${fmt(moverVal)}) captures bot's ${targetName} (val=${fmt(targetVal)}) at (${target.x},${target.y})`);
            console.log(`  SEE (from human view) = ${fmt(humanSEE)}  (human wins exchange despite defenders)`);
            console.log(`  Bot defenders: ${botDefenders.map(d => `${d.piece.piece_name}(${fmt(d.value)})`).join(', ')}`);
            console.log('');
          }
        }
      }
    }

    // Apply the move before the hanging-piece scan
    applyMove(pieces, move);

    // ------------------------------------------------------------------
    // 2. After each bot move: scan for bot pieces left hanging
    // ------------------------------------------------------------------
    if (moverOwner === botPlayer) {
      const stateAfter = { pieces: pieces.map(p => ({...p})), gameType };
      const botPieces  = pieces.filter(p => (p.team || p.player_id) === botPlayer);

      for (const bp of botPieces) {
        const bpVal = getPieceValue(bp, bs);
        if (bpVal < 1.5) continue; // skip low-value pieces to reduce noise

        const attackers = getAttackersTo(stateAfter, bp.x, bp.y, humanPlayer, bs);
        if (attackers.length === 0) continue;

        const cheapestAtk = attackers[0];
        const see = staticExchangeEval(
          stateAfter, bp.x, bp.y,
          cheapestAtk.piece.id, cheapestAtk.value, bpVal, humanPlayer, bs
        );

        if (see > 0.5) {
          issues++;
          hangingAfterMove++;
          console.log(`[BOT PIECE HANGING after move ${moveNum}]`);
          console.log(`  Bot just moved ${moverName} to (${move.to.x},${move.to.y})`);
          console.log(`  Left ${bp.piece_name} (val=${fmt(bpVal)}) at (${bp.x},${bp.y}) hanging`);
          console.log(`  Cheapest human attacker: ${cheapestAtk.piece.piece_name} at (${cheapestAtk.piece.x},${cheapestAtk.piece.y}) val=${fmt(cheapestAtk.value)}`);
          console.log(`  SEE if human captures: ${fmt(see)}`);
          console.log('');
        }
      }
    }
  }

  console.log('=================================================================');
  console.log(`ANALYSIS COMPLETE -- ${issues} issue(s) found in ${moves.length} moves`);
  console.log(`  Bot bad captures:   ${botBadCaptures}`);
  console.log(`  Bot pieces lost:    ${botLosses}`);
  console.log(`  Pieces left hanging: ${hangingAfterMove}`);
  console.log('=================================================================');

  await db_pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
