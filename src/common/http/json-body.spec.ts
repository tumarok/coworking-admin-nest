import { parseJsonBody } from './json-body.js';

describe('parseJsonBody', () => {
  it('parses objects and scalars', () => {
    expect(parseJsonBody(Buffer.from('{"a":1}'))).toEqual({ a: 1 });
    expect(parseJsonBody(Buffer.from('"abc"'))).toBe('abc');
    expect(parseJsonBody(Buffer.from('42'))).toBe(42);
    expect(parseJsonBody(Buffer.from('null'))).toBeNull();
  });

  it('treats an empty, whitespace or broken body as no body', () => {
    expect(parseJsonBody(Buffer.alloc(0))).toBeUndefined();
    expect(parseJsonBody(Buffer.from('  '))).toBeUndefined();
    expect(parseJsonBody(Buffer.from('{"a":'))).toBeUndefined();
  });

  it('reads the bytes as UTF-8', () => {
    expect(parseJsonBody(Buffer.from('{"name":"Zażółć"}'))).toEqual({ name: 'Zażółć' });
  });

  it('treats a body that was not read as bytes as no body', () => {
    expect(parseJsonBody(undefined)).toBeUndefined();
    expect(parseJsonBody({})).toBeUndefined();
    expect(parseJsonBody('{}')).toBeUndefined();
  });
});
