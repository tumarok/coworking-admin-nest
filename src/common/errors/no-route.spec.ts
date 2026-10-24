import { noRouteBody } from './no-route.js';

describe('noRouteBody', () => {
  it('names the method and the path below the prefix', () => {
    expect(noRouteBody({ method: 'POST', path: '/api/v1/__reset' })).toEqual({
      message: 'No route for POST /__reset',
    });
  });

  it('names the root of the prefix as /', () => {
    expect(noRouteBody({ method: 'GET', path: '/api/v1' })).toEqual({
      message: 'No route for GET /',
    });
  });

  it('says "Not found" outside the prefix', () => {
    expect(noRouteBody({ method: 'GET', path: '/elsewhere' })).toEqual({ message: 'Not found' });
  });
});
