import { parseQuery } from './parse-query.js';

describe('parseQuery', () => {
  it('returns a flat object of strings', () => {
    expect(parseQuery('page=2&q=loft%20space')).toEqual({ page: '2', q: 'loft space' });
  });

  it('keeps the last value of a repeated key', () => {
    expect(parseQuery('status=active&status=inactive')).toEqual({ status: 'inactive' });
  });

  it('does not nest brackets', () => {
    expect(parseQuery('a[b]=1')).toEqual({ 'a[b]': '1' });
  });

  it('keeps empty values for the pipe to drop', () => {
    expect(parseQuery('q=&page')).toEqual({ q: '', page: '' });
  });
});
