import { locationListQuerySchema, locationPageSchema } from '../../contract/index.js';
import { inlineSchema } from './components.js';

describe('inlineSchema', () => {
  it('describes a schema in full, without references to components', () => {
    const json = JSON.stringify(inlineSchema(locationPageSchema, 'output'));

    expect(json).not.toContain('$ref');
    expect(json).not.toContain('$defs');
    expect(json).toContain('"roomCount"');
  });

  it('describes a request as the client may send it: a key with a default is optional', () => {
    expect(inlineSchema(locationListQuerySchema).required).toBeUndefined();
    expect(inlineSchema(locationListQuerySchema, 'output').required).toEqual(['page', 'limit']);
  });
});
