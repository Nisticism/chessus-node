/*
 * "Yours was one of N winning final moves" - shown when a puzzle is solved and
 * other final moves would have won too (the solve response's otherFinishes,
 * already named in words by the server). Without it a solver who found one of
 * several mates would think it was the only one.
 */
export const otherFinishesText = (list) => {
  if (!Array.isArray(list) || !list.length) return '';
  const names = list.length === 1
    ? list[0]
    : `${list.slice(0, -1).join('; ')} or ${list[list.length - 1]}`;
  return `Yours was one of ${list.length + 1} winning final moves - ${names} would also have won.`;
};
