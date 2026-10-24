import { formatId, sequenceOf } from './ids.js';

describe('entity ids', () => {
  it('formats the counter in base36 below the prefix', () => {
    expect(formatId('loc', 1)).toBe('loc_1');
    expect(formatId('bk', 118)).toBe('bk_3a');
    expect(formatId('bk', 1411n)).toBe('bk_137');
    expect(formatId('mem', 138)).toBe('mem_3u');
  });

  it('reads the counter back from an id', () => {
    expect(sequenceOf('room_6')).toBe(6);
    expect(sequenceOf('bk_137')).toBe(1411);
  });

  it.each(['usr', 'bk_', 'bk_?!', 'BK_1'])('rejects %s', (id) => {
    expect(() => sequenceOf(id)).toThrow('Not an entity id');
  });
});
