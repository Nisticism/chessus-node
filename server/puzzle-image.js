/*
 * A puzzle position, drawn as a PNG.
 *
 * Discord renders no HTML. The daily post in a channel is a message with an
 * image on it, so the board has to be composed here rather than in a browser -
 * and the piece art is whatever the creator uploaded, at whatever size, in SVG
 * or PNG, so there is no unicode-chess-glyph shortcut to fall back on.
 *
 * The same image is useful beyond Discord: a link preview, a social card, an
 * <img> in an email. Nothing in here knows about Discord.
 *
 * Everything is composed with sharp, which is already a dependency (the image
 * moderation path uses it). SVG rasterises through it; PNG composites directly.
 */

const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');

// Big enough to read on a phone, small enough that a day's cache is nothing.
const DEFAULT_SQUARE = 72;
const MAX_CANVAS = 1400;

// The site's own board, for a viewer whose preference we do not know.
const LIGHT = '#cad5e8';
const DARK = '#08234d';
// The last move and the wrong guess, matching what the web board draws.
const HIGHLIGHT = '#f0c419';
const WRONG = '#d9534f';

const clampHex = (v, fallback) =>
  (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v.trim()) ? v.trim() : fallback);

/**
 * Where a piece's art lives on disk.
 *
 * Mirrors the precedence the front end uses, and stops there: a placement's own
 * image_url wins, else the piece's image_location indexed by player. A path is
 * only ever resolved INSIDE the uploads directory - the value comes from a
 * database row a user filled in, so `../` in it must not be able to read the
 * filesystem.
 */
function resolveArtPath(placement, uploadsBase) {
  const raw = placement?.image_url || (() => {
    if (!placement?.image_location) return null;
    try {
      const images = typeof placement.image_location === 'string'
        ? JSON.parse(placement.image_location)
        : placement.image_location;
      if (!Array.isArray(images) || !images.length) return null;
      const idx = Math.min(Math.max(0, Number(placement.player_id || 1) - 1), images.length - 1);
      return images[idx];
    } catch (_) { return null; }
  })();

  if (typeof raw !== 'string' || !raw) return null;
  if (/^https?:\/\//i.test(raw)) return null;   // remote art is not fetched here

  // Stored as '/uploads/pieces/x.png'; the base already IS the uploads dir.
  const rel = raw.replace(/^\/?uploads\/?/, '');
  const full = path.resolve(uploadsBase, rel);
  const base = path.resolve(uploadsBase);
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}

/** A flat coloured rectangle, as a PNG buffer. */
const rect = (w, h, color) =>
  sharp({ create: { width: w, height: h, channels: 4, background: color } }).png().toBuffer();

/**
 * The first letter of a piece's name, drawn as a chip.
 *
 * The fallback for a piece with no usable art. A blank square would make the
 * position unreadable, which is worse than a plain letter.
 */
function letterTile(square, letter, player) {
  const size = Math.round(square * 0.62);
  const fill = player === 2 ? '#1b1b1b' : '#f7f7f7';
  const ink = player === 2 ? '#f7f7f7' : '#1b1b1b';
  const safe = String(letter || '?').slice(0, 1)
    .replace(/[<>&"']/g, '');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${square}" height="${square}">
       <circle cx="${square / 2}" cy="${square / 2}" r="${size / 2}"
               fill="${fill}" stroke="${ink}" stroke-width="${Math.max(1, square * 0.03)}"/>
       <text x="${square / 2}" y="${square / 2}" fill="${ink}"
             font-family="Helvetica, Arial, sans-serif" font-size="${size * 0.62}"
             font-weight="700" text-anchor="middle" dominant-baseline="central"
             >${safe.toUpperCase()}</text>
     </svg>`
  );
}

/**
 * Draw a puzzle position.
 *
 * @param {object}   opts
 * @param {number}   opts.boardWidth
 * @param {number}   opts.boardHeight
 * @param {object[]} opts.position      Placements: {x, y, player_id, piece_name,
 *                                      image_url, image_location}.
 * @param {string}   opts.uploadsBase   Absolute path to the uploads directory.
 * @param {string}  [opts.lightColor]
 * @param {string}  [opts.darkColor]
 * @param {object}  [opts.highlight]    {from:{x,y}, to:{x,y}} - the setup move.
 * @param {object}  [opts.wrong]        {x,y} - a square to mark as a bad guess.
 * @param {boolean} [opts.flip]         Draw from player 2's side.
 * @returns {Promise<Buffer>} A PNG.
 */
async function renderPuzzle({
  boardWidth, boardHeight, position = [], uploadsBase,
  lightColor, darkColor, highlight = null, wrong = null, flip = false,
}) {
  const w = Math.max(1, Math.min(24, Number(boardWidth) || 8));
  const h = Math.max(1, Math.min(24, Number(boardHeight) || 8));

  // Shrink the squares rather than the board when a big board would overflow.
  const square = Math.max(24, Math.min(DEFAULT_SQUARE, Math.floor(MAX_CANVAS / Math.max(w, h))));
  const light = clampHex(lightColor, LIGHT);
  const dark = clampHex(darkColor, DARK);

  const canvasW = w * square;
  const canvasH = h * square;

  /*
   * Screen coordinates for a board coordinate. Row 0 is the TOP of the stored
   * position, and player 1 looks at it from the bottom, which is why the
   * unflipped view is the identity and flipping mirrors both axes.
   */
  const place = (x, y) => (flip
    ? { left: (w - 1 - x) * square, top: (h - 1 - y) * square }
    : { left: x * square, top: y * square });

  const layers = [];

  // The chequer.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const { left, top } = place(x, y);
      layers.push({
        input: await rect(square, square, (x + y) % 2 === 0 ? light : dark),
        left, top,
      });
    }
  }

  // The setup move, so the position reads as a moment in a game rather than an
  // arrangement of pieces. Drawn under the art, as a translucent wash.
  const wash = (hex, alpha) => rect(square, square, {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
    alpha,
  });
  for (const sq of [highlight?.from, highlight?.to].filter(Boolean)) {
    const { left, top } = place(Number(sq.x), Number(sq.y));
    layers.push({ input: await wash(HIGHLIGHT, 0.45), left, top });
  }
  if (wrong) {
    const { left, top } = place(Number(wrong.x), Number(wrong.y));
    layers.push({ input: await wash(WRONG, 0.5), left, top });
  }

  // The pieces.
  const inset = Math.round(square * 0.08);
  const art = square - inset * 2;
  for (const pl of position) {
    const x = Number(pl.x);
    const y = Number(pl.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const { left, top } = place(x, y);

    const file = resolveArtPath(pl, uploadsBase);
    let input = null;
    if (file) {
      try {
        const raw = await fs.readFile(file);
        input = await sharp(raw)
          .resize(art, art, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toBuffer();
      } catch (_) {
        // Missing or unreadable art falls back to the letter, rather than
        // leaving a hole where a piece is standing.
        input = null;
      }
    }
    if (input) {
      layers.push({ input, left: left + inset, top: top + inset });
    } else {
      layers.push({
        input: await sharp(letterTile(square, pl.piece_name, Number(pl.player_id) || 1)).png().toBuffer(),
        left, top,
      });
    }
  }

  return sharp({ create: { width: canvasW, height: canvasH, channels: 4, background: dark } })
    .composite(layers)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

module.exports = { renderPuzzle, DEFAULT_SQUARE };
