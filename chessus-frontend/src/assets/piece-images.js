import pieceCredits from './piece-credits';

// Legacy piece imports (used by Home.js board demo and pieces.js)
import whitepawn from './pieces/legacy/White-pawn.png';
import blackpawn from './pieces/legacy/Black-pawn.png';
import whiteknight from './pieces/legacy/White-knight.png';
import blackknight from './pieces/legacy/Black-knight.png';
import whitebishup from './pieces/legacy/White-bishup.png';
import blackbishup from './pieces/legacy/Black-bishup.png';
import whiterook from './pieces/legacy/White-rook.png';
import blackrook from './pieces/legacy/Black-rook.png';
import whitequeen from './pieces/legacy/White-queen.png';
import blackqueen from './pieces/legacy/Black-queen.png';
import whiteking from './pieces/legacy/White-king.png';
import blackking from './pieces/legacy/Black-king.png';

export const WhitePawn = whitepawn;
export const BlackPawn = blackpawn;
export const WhiteKnight = whiteknight;
export const BlackKnight = blackknight;
export const WhiteBishup = whitebishup;
export const BlackBishup = blackbishup;
export const WhiteRook = whiterook;
export const BlackRook = blackrook;
export const WhiteQueen = whitequeen;
export const BlackQueen = blackqueen;
export const WhiteKing = whiteking;
export const BlackKing = blackking;

// --- Piece type detection from filename ---
const TYPE_MAP = { b: 'Bishop', k: 'King', n: 'Knight', p: 'Pawn', q: 'Queen', r: 'Rook' };

const LEGACY_TYPE_MAP = {
  pawn: 'Pawn', knight: 'Knight', bishup: 'Bishop', bishop: 'Bishop',
  rook: 'Rook', queen: 'Queen', king: 'King'
};

const detectType = (fileName) => {
  const stem = fileName.replace(/\.[^.]+$/, '').toLowerCase();
  // 2-char SVG names: first char is type letter
  if (stem.length === 2 && TYPE_MAP[stem[0]]) return TYPE_MAP[stem[0]];
  // Legacy: "White-king.png" or "black-swordsman.png"
  const namePart = stem.replace(/^(white|black)[-_]?/i, '');
  if (LEGACY_TYPE_MAP[namePart]) return LEGACY_TYPE_MAP[namePart];
  return 'Other';
};

const detectColor = (fileName) => {
  const lower = fileName.toLowerCase();
  if (lower.startsWith('white')) return 'White';
  if (lower.startsWith('black')) return 'Black';
  const stem = lower.replace(/\.[^.]+$/, '');
  if (stem.length === 2) {
    if (stem.endsWith('w')) return 'White';
    if (stem.endsWith('b')) return 'Black';
  }
  return 'Other';
};

const toTitleCase = (value) => value
  .replace(/[-_]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/\b\w/g, (char) => char.toUpperCase());

// --- Build library from all images in pieces/ ---
const imageLibraryContext = require.context('./pieces', true, /\.(png|jpe?g|svg|webp)$/i);

// Build metadata only — defer image resolution until accessed
const _libraryKeys = imageLibraryContext.keys();
let _libraryCache = null;

const buildLibraryEntry = (key) => {
  const normalizedPath = key.replace('./', '');
  const pathParts = normalizedPath.split('/');
  const fileName = pathParts[pathParts.length - 1];

  let category, style, creditKey;
  if (pathParts.length >= 3) {
    category = pathParts[0];
    style = pathParts[1];
    creditKey = `${category}/${style}`;
  } else if (pathParts.length === 2 && pathParts[0] === 'legacy') {
    category = 'legacy';
    style = '';
    creditKey = null;
  } else {
    category = 'legacy';
    style = '';
    creditKey = null;
  }

  const credit = creditKey ? (pieceCredits[creditKey] || null) : null;
  const color = detectColor(fileName);
  const type = detectType(fileName);

  return {
    name: toTitleCase(fileName.replace(/\.[^.]+$/, '')),
    _key: key,
    get src() {
      // Resolve the actual image URL on first access
      if (!this._resolved) {
        this._resolved = imageLibraryContext(key);
      }
      return this._resolved;
    },
    category: toTitleCase(category),
    style: style ? toTitleCase(style) : '',
    color,
    type,
    credit
  };
};

// Lazy getter — only builds the full sorted array on first access
export const getPieceImageLibrary = () => {
  if (!_libraryCache) {
    _libraryCache = _libraryKeys
      .map(buildLibraryEntry)
      .sort((left, right) => {
        if (left.category === right.category) {
          if (left.style === right.style) {
            return left.name.localeCompare(right.name);
          }
          return left.style.localeCompare(right.style);
        }
        return left.category.localeCompare(right.category);
      });
  }
  return _libraryCache;
};

// Keep backward-compatible export (builds on first access via getter)
export const pieceImageLibrary = new Proxy([], {
  get(target, prop) {
    const lib = getPieceImageLibrary();
    if (prop === 'length') return lib.length;
    if (prop === Symbol.iterator) return lib[Symbol.iterator].bind(lib);
    if (typeof prop === 'string' && !isNaN(prop)) return lib[Number(prop)];
    if (typeof lib[prop] === 'function') return lib[prop].bind(lib);
    return lib[prop];
  }
});