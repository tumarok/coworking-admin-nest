import { pageOffset, toPage } from './page.js';

describe('pageOffset', () => {
  it.each([
    [{ page: 1, limit: 20 }, 0],
    [{ page: 2, limit: 20 }, 20],
    [{ page: 3, limit: 5 }, 10],
    [{ page: 99, limit: 100 }, 9800],
  ])('skips the rows of the pages before %j', (request, offset) => {
    expect(pageOffset(request)).toBe(offset);
  });
});

describe('toPage', () => {
  it('echoes page and limit and keeps the total of all matches', () => {
    expect(toPage(['a', 'b'], 32, { page: 2, limit: 2 })).toEqual({
      items: ['a', 'b'],
      total: 32,
      page: 2,
      limit: 2,
    });
  });

  it('is an empty page beyond the last one, with the total intact', () => {
    expect(toPage([], 32, { page: 99, limit: 20 })).toEqual({
      items: [],
      total: 32,
      page: 99,
      limit: 20,
    });
  });
});
