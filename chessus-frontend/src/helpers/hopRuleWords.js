import { straightHopRule } from './moveEngine';

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
