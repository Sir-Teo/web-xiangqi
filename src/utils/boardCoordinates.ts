import type { XiangqiNotationStyle } from './xiangqiNotation';

/** File numbers are read from the owning player's right, independent of board orientation. */
export function boardFileLabel(file: number, side: 'red' | 'black', notation: XiangqiNotationStyle): string {
  if (notation === 'uci') return 'abcdefghi'[file] ?? '';
  const number = side === 'red' ? 9 - file : file + 1;
  return notation === 'chinese' && side === 'red' ? '一二三四五六七八九'[number - 1] : String(number);
}
