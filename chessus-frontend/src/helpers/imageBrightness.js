// Lightweight client-side image brightness analysis.
// Used by the game wizard to warn when a player has been assigned a piece image
// whose brightness doesn't match (dark image on player 1, light image on player 2).

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";

// Cache by URL so we don't re-decode the same image repeatedly.
const brightnessCache = new Map();

const toAbsoluteUrl = (path) => {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return `${ASSET_URL}${path.startsWith('/') ? path : `/uploads/pieces/${path}`}`;
};

/**
 * Returns a Promise resolving to the average luminance (0..255) of the
 * non-transparent pixels of an image. Resolves to null on failure.
 */
export const getImageBrightness = (imagePath) => {
  if (!imagePath) return Promise.resolve(null);
  if (brightnessCache.has(imagePath)) return Promise.resolve(brightnessCache.get(imagePath));

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 32; // small sample for speed
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let total = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a < 32) continue; // ignore mostly-transparent pixels
          // Rec. 709 luma
          const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          total += lum;
          count += 1;
        }
        const avg = count > 0 ? total / count : null;
        brightnessCache.set(imagePath, avg);
        resolve(avg);
      } catch {
        brightnessCache.set(imagePath, null);
        resolve(null);
      }
    };
    img.onerror = () => {
      brightnessCache.set(imagePath, null);
      resolve(null);
    };
    img.src = toAbsoluteUrl(imagePath);
  });
};

// Pieces lighter than this look "white"; below `DARK_THRESHOLD` look "black".
// Anything in between is treated as ambiguous (no warning).
const LIGHT_THRESHOLD = 170;
const DARK_THRESHOLD = 90;

/**
 * Given a list of placements (each with player_id and a resolved imageUrl),
 * return a list of { key, player_id, brightness, kind } entries that look mismatched
 * (kind = 'dark-on-p1' or 'light-on-p2').
 *
 * placements: Array<{ key, player_id, imageUrl }>
 */
export const findMismatchedPlacements = async (placements) => {
  if (!Array.isArray(placements) || placements.length === 0) return [];

  // De-dupe URL fetches
  const uniqueUrls = Array.from(new Set(placements.map(p => p.imageUrl).filter(Boolean)));
  const brightnessByUrl = new Map();
  await Promise.all(uniqueUrls.map(async (url) => {
    const b = await getImageBrightness(url);
    brightnessByUrl.set(url, b);
  }));

  const mismatches = [];
  for (const p of placements) {
    if (!p.imageUrl) continue;
    const b = brightnessByUrl.get(p.imageUrl);
    if (b == null) continue;
    if (p.player_id === 1 && b < DARK_THRESHOLD) {
      mismatches.push({ ...p, brightness: b, kind: 'dark-on-p1' });
    } else if (p.player_id === 2 && b > LIGHT_THRESHOLD) {
      mismatches.push({ ...p, brightness: b, kind: 'light-on-p2' });
    }
  }
  return mismatches;
};
