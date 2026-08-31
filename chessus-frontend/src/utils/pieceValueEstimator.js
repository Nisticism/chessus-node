/**
 * Estimates the value of a piece by simulating it at the center of an empty
 * board and counting every square it can move to (+1.0 each, step squares ×1.2)
 * and every square it can attack (+1.0 each, +1.5 for ranged, step attack ×1.2,
 * ×0.5 for first-move-only attacks).
 *
 * Global multipliers:
 *   No attack ability              → ×0.6
 *   Ghostwalk                      → ×1.4
 *   Can promote                    → ×1.2
 *   Cannot be captured             → ×1.6
 *   Dies on capture                → ×0.8
 *   Hop (both sides)               → ×1.15  (one side → ×1.1)
 *   Capture on hop                 → ×1.1 (when hopping enabled)
 *   Chain capture                  → ×1.1
 *   Extra capture actions/turn     → up to ×1.32 (×0.08 per extra action)
 *   Extra ranged capture actions   → up to ×1.28 (×0.07 per extra action)
 *   Fire-over (both sides)         → ×1.15 (one side → ×1.1, ranged only)
 *   Hop-attack-over (both sides)   → ×1.15 (one side → ×1.1, ranged only)
 *   Min turns until movement > 0   → ×max(0.5, 1 − turns×0.1)
 *   No forward or no backward      → ×0.7
 *   Attack/trample radius (any)    → attack contribution ×1.25
 *
 * User-facing value = internalValue / 5.5, rounded to 1 decimal.
 * Rook baseline: 14 move + 14 attack = 28 → 5.1 on 8×8.
 */
export function estimatePieceValue(piece, boardWidth = 8, boardHeight = 8) {
  if (!piece) return 0;
  if (piece.is_neutral || piece.player_id === 0) return 0;

  const bw = boardWidth  || 8;
  const bh = boardHeight || 8;
  const cx = Math.floor((bw - 1) / 2);
  const cy = Math.floor((bh - 1) / 2);
  const DIVISOR = 5.5;
  const isOnBoard = (x, y) => x >= 0 && x < bw && y >= 0 && y < bh;

  const moveSet      = new Set();
  const stepMoveSet   = new Set(); // squares reached via step-by-step movement (weighted ×1.2)
  const attackMap    = new Map(); // key → max-weight applied
  const stepAttackSet = new Set(); // squares attacked via step movement/capture (weighted ×1.2)
  const addAttack = (key, w) => {
    const cur = attackMap.get(key);
    if (cur === undefined || w > cur) attackMap.set(key, w);
  };

  function walkDir(dx, dy, range, exact, repeating) {
    if (!range || range === 0) return [];
    const absRange = Math.abs(range);
    const isExact  = exact || range < 0;
    const limit    = absRange === 99 ? Math.max(bw, bh) : absRange;
    const maxIter  = (isExact && repeating) ? Math.max(bw, bh) : limit;
    const result   = [];
    for (let dist = 1; dist <= maxIter; dist++) {
      const x = cx + dx * dist, y = cy + dy * dist;
      if (!isOnBoard(x, y)) break;
      if (!isExact || (repeating ? dist % absRange === 0 : dist === absRange)) {
        result.push(`${x},${y}`);
      }
    }
    return result;
  }

  const hasDedicatedCap = !!(
    piece.up_capture    || piece.down_capture    ||
    piece.left_capture  || piece.right_capture   ||
    piece.up_left_capture   || piece.up_right_capture  ||
    piece.down_left_capture || piece.down_right_capture ||
    piece.ratio_capture_1   || piece.ratio_one_capture  ||
    piece.ratio_capture_2   || piece.ratio_two_capture
  );
  const canCaptureOnMove     = !!(piece.can_capture_enemy_on_move);
  const firstMoveOnlyCapture = !!(piece.first_move_only_capture);
  const repM = !!piece.repeating_movement;
  const repC = !!piece.repeating_capture;

  const dirs = [
    { name: 'up',         dx: 0,  dy: -1 },
    { name: 'down',       dx: 0,  dy:  1 },
    { name: 'left',       dx: -1, dy:  0 },
    { name: 'right',      dx:  1, dy:  0 },
    { name: 'up_left',    dx: -1, dy: -1 },
    { name: 'up_right',   dx:  1, dy: -1 },
    { name: 'down_left',  dx: -1, dy:  1 },
    { name: 'down_right', dx:  1, dy:  1 },
  ];

  for (const dir of dirs) {
    const moveRange = piece[`${dir.name}_movement`] || 0;
    const capRange  = piece[`${dir.name}_capture`]  || 0;
    const moveExact = !!piece[`${dir.name}_movement_exact`];
    const capExact  = !!piece[`${dir.name}_capture_exact`];
    const dirAvailFor = piece[`${dir.name}_movement_available_for`] || 0;
    const dirFMO      = dirAvailFor > 0;

    if (moveRange > 0) {
      const sqs = walkDir(dir.dx, dir.dy, moveRange, moveExact, repM && moveExact);
      for (const key of sqs) {
        moveSet.add(key);
        if (canCaptureOnMove && (!hasDedicatedCap || capRange > 0)) {
          addAttack(key, (firstMoveOnlyCapture || dirFMO) ? 0.5 : 1.0);
        }
      }
    }
    if (capRange > 0) {
      for (const key of walkDir(dir.dx, dir.dy, capRange, capExact, repC && capExact)) {
        addAttack(key, firstMoveOnlyCapture ? 0.5 : 1.0);
      }
    }
  }

  // Ranged attack
  if (piece.can_capture_enemy_via_range) {
    const rd = [
      { f: 'up_attack_range',         dx: 0,  dy: -1 },
      { f: 'down_attack_range',        dx: 0,  dy:  1 },
      { f: 'left_attack_range',        dx: -1, dy:  0 },
      { f: 'right_attack_range',       dx:  1, dy:  0 },
      { f: 'up_left_attack_range',     dx: -1, dy: -1 },
      { f: 'up_right_attack_range',    dx:  1, dy: -1 },
      { f: 'down_left_attack_range',   dx: -1, dy:  1 },
      { f: 'down_right_attack_range',  dx:  1, dy:  1 },
    ];
    for (const d of rd) {
      const range = piece[d.f] || 0;
      if (!range) continue;
      for (const key of walkDir(d.dx, d.dy, range, !!piece[`${d.f}_exact`], false)) {
        addAttack(key, 1.5);
      }
    }
    // step_by_step_attack_range is the remapped live-game field (computed in game-socket.js).
    // Raw API/DB pieces have step_by_step_attack_value + step_by_step_attack_style instead.
    const sarRaw = piece.step_by_step_attack_value;
    const sar = piece.step_by_step_attack_range
      ?? ((sarRaw != null && sarRaw !== 0)
          ? (piece.step_by_step_attack_style ? -Math.abs(Number(sarRaw)) : Number(sarRaw))
          : null);
    if (sar != null && sar !== 0) {
      const sarSteps = Math.abs(sar);
      const noDiag   = sar < 0;
      const sarDirs  = noDiag ? [[1,0],[-1,0],[0,1],[0,-1]] : [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
      const visited  = new Set([`${cx},${cy}`]);
      const queue    = [{ x: cx, y: cy, steps: 0 }];
      while (queue.length) {
        const c = queue.shift();
        if (c.steps >= sarSteps) continue;
        for (const [dx, dy] of sarDirs) {
          const nx = c.x + dx, ny = c.y + dy;
          if (!isOnBoard(nx, ny)) continue;
          const key = `${nx},${ny}`;
          if (visited.has(key)) continue;
          visited.add(key);
          stepAttackSet.add(key);
          addAttack(key, 1.5);
          queue.push({ x: nx, y: ny, steps: c.steps + 1 });
        }
      }
    }
    const rar1 = piece.ratio_one_attack_range || 0;
    const rar2 = piece.ratio_two_attack_range || 0;
    if (rar1 > 0 && rar2 > 0) {
      for (const [dx, dy] of [[rar1,rar2],[rar1,-rar2],[-rar1,rar2],[-rar1,-rar2],[rar2,rar1],[rar2,-rar1],[-rar2,rar1],[-rar2,-rar1]]) {
        const x = cx + dx, y = cy + dy;
        if (isOnBoard(x, y)) addAttack(`${x},${y}`, 1.5);
      }
    }
  }

  // Ratio movement (handle both remapped JS names and raw DB column names)
  const r1 = piece.ratio_movement_1 || piece.ratio_one_movement || 0;
  const r2 = piece.ratio_movement_2 || piece.ratio_two_movement || 0;
  if (r1 > 0 && r2 > 0) {
    const maxK = piece.repeating_ratio
      ? (piece.max_ratio_iterations === -1 ? Math.max(bw, bh) : (piece.max_ratio_iterations || 2)) : 1;
    for (const [dx, dy] of [[r1,r2],[r1,-r2],[-r1,r2],[-r1,-r2],[r2,r1],[r2,-r1],[-r2,r1],[-r2,-r1]]) {
      for (let k = 1; k <= maxK; k++) {
        const x = cx + dx * k, y = cy + dy * k;
        if (!isOnBoard(x, y)) break;
        const key = `${x},${y}`;
        moveSet.add(key);
        if (canCaptureOnMove && !hasDedicatedCap) addAttack(key, firstMoveOnlyCapture ? 0.5 : 1.0);
      }
    }
  }

  // Ratio capture (handle both remapped JS names and raw DB column names)
  const rc1 = piece.ratio_capture_1 || piece.ratio_one_capture || 0;
  const rc2 = piece.ratio_capture_2 || piece.ratio_two_capture || 0;
  if (rc1 > 0 && rc2 > 0) {
    const maxK = piece.repeating_ratio_capture
      ? (piece.max_ratio_capture_iterations === -1 ? Math.max(bw, bh) : (piece.max_ratio_capture_iterations || 2)) : 1;
    for (const [dx, dy] of [[rc1,rc2],[rc1,-rc2],[-rc1,rc2],[-rc1,-rc2],[rc2,rc1],[rc2,-rc1],[-rc2,rc1],[-rc2,-rc1]]) {
      for (let k = 1; k <= maxK; k++) {
        const x = cx + dx * k, y = cy + dy * k;
        if (!isOnBoard(x, y)) break;
        addAttack(`${x},${y}`, firstMoveOnlyCapture ? 0.5 : 1.0);
      }
    }
  }

  // Step movement (BFS)
  const stepStyle = Number(piece.step_by_step_movement_value ?? piece.step_movement_value ?? 0) !== 0;
  if (stepStyle) {
    const stepVal = Number(piece.step_by_step_movement_value ?? piece.step_movement_value ?? 0);
    if (!isNaN(stepVal) && stepVal !== 0) {
      const maxS    = Math.abs(stepVal);
      const noDiag  = stepVal < 0;
      const mDirs   = noDiag ? [[1,0],[-1,0],[0,1],[0,-1]] : [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
      const vis     = new Set([`${cx},${cy}`]);
      const q       = [{ x: cx, y: cy, steps: 0 }];
      while (q.length) {
        const c = q.shift();
        if (c.steps >= maxS) continue;
        for (const [dx, dy] of mDirs) {
          const nx = c.x + dx, ny = c.y + dy;
          if (!isOnBoard(nx, ny)) continue;
          const key = `${nx},${ny}`;
          if (vis.has(key)) continue;
          vis.add(key); moveSet.add(key); stepMoveSet.add(key);
          q.push({ x: nx, y: ny, steps: c.steps + 1 });
        }
      }
      // step_capture_value is the remapped JS name; step_by_step_capture is the DB column name
      const capValRaw = piece.step_capture_value ?? piece.step_by_step_capture;
      const capVal    = Number(capValRaw ?? 0);
      const hasStepCap = capValRaw != null && capValRaw !== 0 && !isNaN(capVal);
      if (hasStepCap) {
        const cS    = Math.abs(capVal);
        const ncDiag = capVal < 0;
        const cDirs  = ncDiag ? [[1,0],[-1,0],[0,1],[0,-1]] : [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
        const cv    = new Set([`${cx},${cy}`]);
        const cq    = [{ x: cx, y: cy, steps: 0 }];
        while (cq.length) {
          const c = cq.shift();
          for (const [dx, dy] of cDirs) {
            const nx = c.x + dx, ny = c.y + dy;
            if (!isOnBoard(nx, ny)) continue;
            if (c.steps + 1 <= cS) { stepAttackSet.add(`${nx},${ny}`); addAttack(`${nx},${ny}`, firstMoveOnlyCapture ? 0.5 : 1.0); }
          }
          if (c.steps < maxS) {
            for (const [dx, dy] of mDirs) {
              const nx = c.x + dx, ny = c.y + dy;
              if (!isOnBoard(nx, ny)) continue;
              const key = `${nx},${ny}`;
              if (!cv.has(key)) { cv.add(key); cq.push({ x: nx, y: ny, steps: c.steps + 1 }); }
            }
          }
        }
      } else if (canCaptureOnMove && !hasDedicatedCap) {
        for (const sq of moveSet) {
          if (stepMoveSet.has(sq)) stepAttackSet.add(sq);
          addAttack(sq, firstMoveOnlyCapture ? 0.5 : 1.0);
        }
      }
    }
  }

  // Additional movements (special_scenario_moves)
  let addMovements = {};
  if (piece.special_scenario_moves) {
    try {
      const p = typeof piece.special_scenario_moves === 'string'
        ? JSON.parse(piece.special_scenario_moves) : piece.special_scenario_moves;
      addMovements = p.additionalMovements || {};
    } catch (_) {}
  }
  const dmap = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0], up_left:[-1,-1], up_right:[1,-1], down_left:[-1,1], down_right:[1,1] };
  for (const [dir, opts] of Object.entries(addMovements)) {
    const [dx, dy] = dmap[dir] || [0, 0];
    if (!dx && !dy) continue;
    for (const opt of opts) {
      const fmo = !!(opt.firstMoveOnly || opt.availableForMoves > 0);
      let maxD = opt.value || 0;
      if (opt.infinite) maxD = 99;
      for (const key of walkDir(dx, dy, maxD, !!opt.exact, false)) {
        moveSet.add(key);
        if (canCaptureOnMove && !hasDedicatedCap) addAttack(key, (firstMoveOnlyCapture || fmo) ? 0.5 : 1.0);
      }
    }
  }

  // Snapshot pre-custom sets so we can identify squares NEWLY added by custom squares
  const preCustMoveKeys   = new Set(moveSet);
  const preCustAttackKeys = new Set(attackMap.keys());

  // Custom movement squares (MOVEMENT ONLY — captures live on
  // custom_attack_squares; never contribute to attack/threat).
  if (piece.custom_movement_squares) {
    try {
      const c = typeof piece.custom_movement_squares === 'string'
        ? JSON.parse(piece.custom_movement_squares) : piece.custom_movement_squares;
      if (Array.isArray(c)) {
        for (const sq of c) {
          const x = cx + (sq.col || 0), y = cy + (sq.row || 0);
          if (!isOnBoard(x, y)) continue;
          moveSet.add(`${x},${y}`);
        }
      }
    } catch (_) {}
  }

  // Custom attack squares
  if (piece.custom_attack_squares) {
    try {
      const c = typeof piece.custom_attack_squares === 'string'
        ? JSON.parse(piece.custom_attack_squares) : piece.custom_attack_squares;
      if (Array.isArray(c)) {
        for (const sq of c) {
          const x = cx + (sq.col || 0), y = cy + (sq.row || 0);
          if (isOnBoard(x, y)) addAttack(`${x},${y}`, firstMoveOnlyCapture ? 0.5 : 1.0);
        }
      }
    } catch (_) {}
  }

  // Keys newly contributed by custom squares (used for 1.25× bonus)
  const customMoveKeys   = new Set([...moveSet].filter(k => !preCustMoveKeys.has(k)));
  const customAttackKeys = new Set([...attackMap.keys()].filter(k => !preCustAttackKeys.has(k)));

  // Compute internal value
  // Color-bound check: every target square is compared against the parity of
  // the CENTER square. If every reachable square matches the center's parity,
  // the piece can never reach the other color (bishop) → apply ×0.7 penalty.
  // If every reachable square is the OPPOSITE parity (knight), the piece
  // alternates colors each move and is not color-bound → no penalty.
  // Move and attack contributions are checked independently.
  const centerParity = (cx + cy) % 2;
  function isColorBound(keys) {
    const arr = [...keys];
    if (arr.length === 0) return false;
    return arr.every(k => { const [x, y] = k.split(',').map(Number); return (x + y) % 2 === centerParity; });
  }

  let moveContrib = 0;
  for (const key of moveSet) {
    const base = stepMoveSet.has(key) ? 1.2 : 1.0;
    moveContrib += customMoveKeys.has(key) ? base * 1.25 : base;
  }
  if (isColorBound(moveSet)) moveContrib *= 0.7;

  let attackContrib = 0;
  for (const [key, w] of attackMap) {
    const base = stepAttackSet.has(key) ? w * 1.2 : w;
    attackContrib += customAttackKeys.has(key) ? base * 1.25 : base;
  }
  if (isColorBound(attackMap.keys())) attackContrib *= 0.7;

  if ((piece.attack_radius || 0) > 0 || (piece.trample_radius || 0) > 0) attackContrib *= 1.25;
  let internal = moveContrib + attackContrib;

  if (attackContrib === 0)                                  internal *= 0.6;
  if (piece.ghostwalk)                                      internal *= 1.4;
  if (piece.can_promote)                                    internal *= 1.2;
  if (piece.cannot_be_captured)                             internal *= 1.6;
  if (piece.die_on_capture || piece.dies_on_capture)        internal *= 0.8;

  // Hop bonus: hopping lets a piece ignore blocker pieces, increasing effective mobility
  const canHopAllies  = !!(piece.can_hop_over_allies);
  const canHopEnemies = !!(piece.can_hop_over_enemies);
  if (canHopAllies && canHopEnemies) internal *= 1.15;
  else if (canHopAllies || canHopEnemies) internal *= 1.1;

  // Additional wizard-level attack/mobility features
  const captureActionsPerTurn = piece.capture_actions_per_turn || 1;
  if (captureActionsPerTurn > 1 || captureActionsPerTurn === -1) {
    const extra = captureActionsPerTurn === -1 ? 4 : Math.min(captureActionsPerTurn - 1, 4);
    internal *= 1 + extra * 0.08; // up to ×1.32 for 5+ actions or unlimited
  }
  const rangedCaptureActionsPerTurn = piece.ranged_capture_actions_per_turn || 1;
  if (rangedCaptureActionsPerTurn > 1 || rangedCaptureActionsPerTurn === -1) {
    const extra = rangedCaptureActionsPerTurn === -1 ? 4 : Math.min(rangedCaptureActionsPerTurn - 1, 4);
    internal *= 1 + extra * 0.07; // up to ×1.28 for 5+ actions or unlimited
  }
  if (piece.capture_on_hop && (canHopAllies || canHopEnemies)) internal *= 1.1;
  if (piece.chain_capture_enabled) internal *= 1.1;
  // Fire-over / hop-attack-over: ranged attacks pass through blocking pieces
  if (piece.can_capture_enemy_via_range) {
    const canFireOverAllies  = !!(piece.can_fire_over_allies);
    const canFireOverEnemies = !!(piece.can_fire_over_enemies);
    if (canFireOverAllies || canFireOverEnemies)
      internal *= (canFireOverAllies && canFireOverEnemies) ? 1.15 : 1.1;
    const canHopAtkAllies  = !!(piece.can_hop_attack_over_allies);
    const canHopAtkEnemies = !!(piece.can_hop_attack_over_enemies);
    if (canHopAtkAllies || canHopAtkEnemies)
      internal *= (canHopAtkAllies && canHopAtkEnemies) ? 1.15 : 1.1;
  }
  // Delay before piece can first move reduces effective value
  // DB column is min_turns_per_move; min_turns_until_movement is the wizard's internal state name.
  const minTurns = piece.min_turns_per_move || piece.min_turns_until_movement || 0;
  if (minTurns > 0) internal *= Math.max(0.5, 1 - minTurns * 0.1);

  // Ratio movement (r1/r2 already resolved above) inherently covers both forward and
  // backward (its 8 symmetric directions include ±dy). Step movement covers all directions.
  const hasRatioMove = r1 > 0 && r2 > 0;
  const hasStepMove  = !!(stepStyle && Number(piece.step_by_step_movement_value ?? piece.step_movement_value ?? 0) !== 0);
  // Also check moveSet for custom_movement_squares / special_scenario_moves coverage
  const hasMoveSetForward  = [...moveSet].some(k => { const [,y] = k.split(',').map(Number); return y < cy; });
  const hasMoveSetBackward = [...moveSet].some(k => { const [,y] = k.split(',').map(Number); return y > cy; });
  const hasForward  = !!(piece.up_movement   || piece.up_capture   || piece.up_left_movement   || piece.up_right_movement   || piece.up_left_capture   || piece.up_right_capture)   || hasRatioMove || hasStepMove || hasMoveSetForward;
  const hasBackward = !!(piece.down_movement || piece.down_capture || piece.down_left_movement || piece.down_right_movement || piece.down_left_capture || piece.down_right_capture) || hasRatioMove || hasStepMove || hasMoveSetBackward;
  if (!hasForward || !hasBackward) internal *= 0.7;

  // HP scaling (for live-captured-piece display)
  const hp    = piece.current_hp ?? piece.hit_points ?? 1;
  const maxHp = piece.hit_points || 1;
  if (maxHp > 1) internal *= (0.5 + 0.5 * hp / maxHp);

  const baseVal = Math.max(0.1, Math.round((internal / DIVISOR) * 10) / 10);
  return piece.can_promote ? Math.round((baseVal + 0.5) * 10) / 10 : baseVal;
}

/**
 * Calculate total material value for a list of pieces.
 * Accepts an optional precomputed pieceValues map (piece_id → base value)
 * from the server; falls back to client-side computation if not provided.
 */
export function totalMaterialValue(pieces, boardWidth = 8, boardHeight = 8, pieceValues = null) {
  return pieces.reduce((sum, p) => {
    if (!p || p.is_neutral || p.player_id === 0) return sum;
    let base;
    if (pieceValues && p.piece_id !== undefined && pieceValues[p.piece_id] !== undefined) {
      base = pieceValues[p.piece_id];
      // Apply HP scaling on top of pre-computed base
      const hp    = p.current_hp ?? p.hit_points ?? 1;
      const maxHp = p.hit_points || 1;
      if (maxHp > 1) base = base * (0.5 + 0.5 * hp / maxHp);
    } else {
      base = estimatePieceValue(p, boardWidth, boardHeight);
    }
    return sum + base;
  }, 0);
}
