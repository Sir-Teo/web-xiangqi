import { describe, expect, it } from 'vitest';
import { boardFileLabel } from './boardCoordinates';

describe('notation-aware board files', () => {
  it('matches each side’s cannon opening in WXF and Chinese', () => {
    expect([7, 4].map(file => boardFileLabel(file, 'red', 'wxf'))).toEqual(['2', '5']);
    expect([7, 4].map(file => boardFileLabel(file, 'red', 'chinese'))).toEqual(['二', '五']);
    expect([1, 4].map(file => boardFileLabel(file, 'black', 'chinese'))).toEqual(['2', '5']);
  });
  it('retains absolute UCI coordinates for both sides', () => {
    for (const side of ['red', 'black'] as const) {
      expect([0, 4, 8].map(file => boardFileLabel(file, side, 'uci'))).toEqual(['a', 'e', 'i']);
    }
  });
});
