// "A", "A or B", "A, B or C" - commas between items, the word only before the last.
export const joinList = (items, word = 'or') => {
  const list = (items || []).filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  return `${list.slice(0, -1).join(', ')} ${word} ${list[list.length - 1]}`;
};

export default joinList;
