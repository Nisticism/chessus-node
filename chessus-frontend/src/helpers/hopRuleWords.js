import { straightHopRule, lPathRule } from './moveEngine';

/*
 * A piece's straight-line hop rule in words, for the piece page and the game
 * page: " · exactly 1 piece in path · lands right behind it". Empty when there
 * is nothing beyond "must hop" to say. Read through straightHopRule, the rule
 * the move engines apply, so the words cannot describe a different rule.
 */
export const hopRuleWords = (piece, attack = false) => {
  const { min, max, landing } = straightHopRule(piece, attack);
  const pieces = (n) => `${n} piece${n === 1 ? '' : 's'} in path`;
  const parts = [];
  if (max != null && max === min) parts.push(`exactly ${pieces(min)}`);
  else {
    if (min > 1) parts.push(`at least ${pieces(min)}`);
    if (max != null) parts.push(`max ${pieces(max)}`);
  }
  if (landing != null) {
    parts.push(landing === 1 ? 'lands right behind the last piece hopped' : `lands within ${landing} squares past the last piece hopped`);
  }
  return parts.length ? ` · ${parts.join(' · ')}` : '';
};

export default hopRuleWords;

/*
 * A piece's L-path rule in words (lPathRule): empty for the default - either
 * route, both legs, corner included - which is what every L-move always did.
 */
export const lPathWords = (piece, attack = false) => {
  const rule = lPathRule(piece, attack);
  if (rule.isDefault) return '';
  if (rule.order === 'long_first' && rule.legs === 'long' && !rule.corner) return ' · blocked only by the square beside it in the long direction (like a Xiangqi horse)';
  const route = { either: 'either route', long_first: 'longer leg first', short_first: 'shorter leg first' }[rule.order];
  const legs = { both: 'blocked on either leg', long: 'blocked on the longer leg only', short: 'blocked on the shorter leg only' }[rule.legs];
  return ` · ${route}, ${legs}${rule.corner ? '' : ', not by the corner square'}`;
};
