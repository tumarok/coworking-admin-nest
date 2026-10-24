import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';

describe('application bootstrap', () => {
  it('answers 404 on an unknown route', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app: INestApplication<App> = moduleRef.createNestApplication();
    await app.init();

    await request(app.getHttpServer()).get('/').expect(404);

    await app.close();
  });
});
