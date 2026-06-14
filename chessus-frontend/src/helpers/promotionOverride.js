// Helpers for the per-placement promotion override data model.
//
// Each entry describes one promotable target and which player's piece it
// becomes when chosen:
//   { id: <pieceId>, player: <playerNumber | 0 for neutral | null for own-side> }
//
// Legacy data stored a plain array of piece IDs (numbers). Those normalize to
// { id, player: null } which means "promote to a piece of the promoting
// player's own side" — matching the original behavior.

/**
 * Normalize any stored/raw promotion override value into an array of
 * { id:number, player:number|null } entries.
 * @param {string|Array|null} raw
 * @returns {Array<{id:number, player:number|null}>}
 */
export function normalizePromotionOverride(raw) {
  if (raw == null) return [];
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  const out = [];
  for (const entry of parsed) {
    if (entry == null) continue;
    if (typeof entry === 'object') {
      const id = Number(entry.id ?? entry.piece_id);
      if (!Number.isFinite(id)) continue;
      const rawPlayer = entry.player ?? entry.player_id;
      const player = rawPlayer == null ? null : Number(rawPlayer);
      out.push({ id, player: Number.isFinite(player) ? player : null });
    } else {
      const id = Number(entry);
      if (!Number.isFinite(id)) continue;
      out.push({ id, player: null });
    }
  }
  return out;
}

/**
 * Serialize an entries array back into a JSON string for storage.
 * Returns null when empty so the column stays NULL (no override).
 * @param {Array<{id:number, player:number|null}>} entries
 * @returns {string|null}
 */
export function serializePromotionOverride(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const clean = entries
    .filter(e => e && Number.isFinite(Number(e.id)))
    .map(e => ({ id: Number(e.id), player: e.player == null ? null : Number(e.player) }));
  return clean.length > 0 ? JSON.stringify(clean) : null;
}

/**
 * Remap player references when mirroring pieces between two players.
 * `swapMap` maps an existing player number to its mirrored counterpart
 * (e.g. { 1: 2, 2: 1 }). Neutral (0) and own-side (null) entries are left
 * untouched.
 * @param {string|Array|null} raw
 * @param {Object<number, number>} swapMap
 * @returns {string|null}
 */
export function remapPromotionOverridePlayers(raw, swapMap) {
  const entries = normalizePromotionOverride(raw);
  if (entries.length === 0) return raw ?? null;
  const remapped = entries.map(e => {
    if (e.player == null || e.player === 0) return { ...e };
    const next = swapMap ? swapMap[e.player] : undefined;
    return { id: e.id, player: next != null ? next : e.player };
  });
  return serializePromotionOverride(remapped);
}
