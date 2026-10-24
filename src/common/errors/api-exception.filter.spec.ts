import { type ArgumentsHost, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { ApiExceptionFilter } from './api-exception.filter.js';

const run = (exception: unknown, request: { method: string; path: string; route?: object }) => {
  let sent: { status: number; body: unknown } | undefined;
  const response = {
    status: (status: number) => ({
      json: (body: unknown) => {
        sent = { status, body };
      },
    }),
  };
  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ArgumentsHost;

  new ApiExceptionFilter().catch(exception, host);
  return sent;
};

describe('ApiExceptionFilter', () => {
  const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

  afterEach(() => {
    error.mockClear();
  });

  it('wraps the message of a framework exception in the error body', () => {
    const sent = run(new BadRequestException('Bad input'), {
      method: 'GET',
      path: '/api/v1/x',
      route: {},
    });

    expect(sent).toEqual({ status: 400, body: { message: 'Bad input' } });
  });

  it('answers 500 for anything else and logs the stack', () => {
    const sent = run(new Error('boom'), { method: 'GET', path: '/api/v1/x', route: {} });

    expect(sent).toEqual({ status: 500, body: { message: 'Internal server error' } });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('logs a thrown value that is not an Error', () => {
    const sent = run('boom', { method: 'GET', path: '/api/v1/x', route: {} });

    expect(sent?.status).toBe(500);
    expect(error).toHaveBeenCalledWith('boom');
  });

  it('answers a request that matched no route with the route message', () => {
    const exception = new NotFoundException('Cannot POST /api/v1/x');

    expect(run(exception, { method: 'POST', path: '/api/v1/x' })).toEqual({
      status: 404,
      body: { message: 'No route for POST /x' },
    });
    expect(run(exception, { method: 'POST', path: '/x' })).toEqual({
      status: 404,
      body: { message: 'Not found' },
    });
  });

  it('does not hide another failure of an unrouted request behind a 404', () => {
    const sent = run(new Error('decode'), { method: 'GET', path: '/api/v1/x' });

    expect(sent).toEqual({ status: 500, body: { message: 'Internal server error' } });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('decode'));
  });
});
