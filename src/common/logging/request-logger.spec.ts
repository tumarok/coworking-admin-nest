import { Logger } from '@nestjs/common';
import express from 'express';
import request from 'supertest';
import { requestLogger } from './request-logger.js';

describe('requestLogger', () => {
  it('logs method, path, status and duration once the response is sent', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const app = express()
      .use(requestLogger())
      .get('/ping', (_request, response) => {
        response.status(201).end();
      });

    await request(app).get('/ping?x=1');

    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[0]).toMatch(/^GET \/ping\?x=1 201 \d+\.\d ms$/);
    log.mockRestore();
  });
});
