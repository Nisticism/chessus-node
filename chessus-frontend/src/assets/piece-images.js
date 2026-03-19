import whitepawn from './pieces/White-pawn.png';
import blackpawn from './pieces/Black-pawn.png';
import whiteknight from './pieces/White-knight.png';
import blackknight from './pieces/Black-knight.png';
import whitebishup from './pieces/White-bishup.png';
import blackbishup from './pieces/Black-bishup.png';
import whiterook from './pieces/White-rook.png';
import blackrook from './pieces/Black-rook.png';
import whitequeen from './pieces/White-queen.png';
import blackqueen from './pieces/Black-queen.png';
import whiteking from './pieces/White-king.png';
import blackking from './pieces/Black-king.png';

import whitechest from './pieces/white-chest.png';
import blackchest from './pieces/black-chest.png';

import whiteswordsman from './pieces/white-swordsman.png';
import blackswordsman from './pieces/black-swordsman.png';

import whitewizard from './pieces/white-wizard.png';
import blackwizard from './pieces/black-wizard.png';

import whitetieronemelee from './pieces/white-tier_one_melee.png';
import blacktieronemelee from './pieces/black-tier_one_melee.png';

import whitetieronerange from './pieces/white-tier_one_range.png';
import blacktieronerange from './pieces/black-tier_one_range.png';

import whitetiertwomelee from './pieces/white-tier_two_melee.png';
import blacktiertwomelee from './pieces/black-tier_two_melee.png';

import whitetiertworange from './pieces/white-tier_two_range.png';
import blacktiertworange from './pieces/black-tier_two_range.png';

import whitetierthreemelee from './pieces/white-tier_three_melee.png';
import blacktierthreemelee from './pieces/black-tier_three_melee.png';

import whitetierthreerange from './pieces/white-tier_three_range.png';
import blacktierthreerange from './pieces/black-tier_three_range.png';

// Pawns
export const WhitePawn = whitepawn;
export const BlackPawn = blackpawn;

// Knights
export const WhiteKnight = whiteknight;
export const BlackKnight = blackknight

// Bishups
export const WhiteBishup = whitebishup;
export const BlackBishup = blackbishup;

// Rooks
export const WhiteRook = whiterook;
export const BlackRook = blackrook;

// Queens
export const WhiteQueen = whitequeen;
export const BlackQueen = blackqueen;

// Kings
export const WhiteKing = whiteking;
export const BlackKing = blackking;

// Chests
export const WhiteChest = whitechest;
export const BlackChest = blackchest;

// Swordsmen
export const WhiteSwordsman = whiteswordsman;
export const BlackSwordsman = blackswordsman;

// Wizards
export const WhiteWizard = whitewizard;
export const BlackWizard = blackwizard;

// Tier One Melee
export const WhiteTierOneMelee = whitetieronemelee;
export const BlackTierOneMelee = blacktieronemelee;

// Tier One Range
export const WhiteTierOneRange = whitetieronerange;
export const BlackTierOneRange = blacktieronerange;

// Tier Two Melee
export const WhiteTierTwoMelee = whitetiertwomelee;
export const BlackTierTwoMelee = blacktiertwomelee;

// Tier Two Range
export const WhiteTierTwoRange = whitetiertworange;
export const BlackTierTwoRange = blacktiertworange;

// Tier Three Melee
export const WhiteTierThreeMelee = whitetierthreemelee;
export const BlackTierThreeMelee = blacktierthreemelee;

// Tier Three Range
export const WhiteTierThreeRange = whitetierthreerange;
export const BlackTierThreeRange = blacktierthreerange;

const toTitleCase = (value) => value
  .replace(/[-_]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/\b\w/g, (char) => char.toUpperCase());

const detectColor = (fileName) => {
  const lower = fileName.toLowerCase();
  // Check prefix: white-xxx or black-xxx
  if (lower.startsWith('white')) return 'White';
  if (lower.startsWith('black')) return 'Black';
  // 2-char SVG names: {piece}{color}.svg — last char before ext determines color
  const stem = lower.replace(/\.[^.]+$/, '');
  if (stem.length === 2) {
    if (stem.endsWith('w')) return 'White';
    if (stem.endsWith('b')) return 'Black';
  }
  return 'Other';
};

const imageLibraryContext = require.context('./pieces', true, /\.(png|jpe?g|svg|webp)$/i);

export const pieceImageLibrary = imageLibraryContext
  .keys()
  .map((key) => {
    const normalizedPath = key.replace('./', '');
    const pathParts = normalizedPath.split('/');
    const fileName = pathParts[pathParts.length - 1];
    const folderName = pathParts.length > 1 ? pathParts[0] : 'Core';
    const displayName = toTitleCase(fileName.replace(/\.[^.]+$/, ''));

    return {
      name: displayName,
      src: imageLibraryContext(key),
      category: toTitleCase(folderName),
      color: detectColor(fileName)
    };
  })
  .sort((left, right) => {
    if (left.category === right.category) {
      return left.name.localeCompare(right.name);
    }
    return left.category.localeCompare(right.category);
  });