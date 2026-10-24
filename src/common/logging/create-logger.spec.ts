import { createLogger } from './create-logger.js';

const levelsOf = (logger: ReturnType<typeof createLogger>) =>
  ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'].filter((level) =>
    logger.isLevelEnabled(level as 'log'),
  );

describe('createLogger', () => {
  it('enables the levels up to LOG_LEVEL', () => {
    expect(levelsOf(createLogger({ NODE_ENV: 'development', LOG_LEVEL: 'warn' }))).toEqual([
      'fatal',
      'error',
      'warn',
    ]);
    expect(levelsOf(createLogger({ NODE_ENV: 'development', LOG_LEVEL: 'verbose' }))).toHaveLength(
      6,
    );
  });

  it('writes one JSON object per line in production', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    createLogger({ NODE_ENV: 'production', LOG_LEVEL: 'log' }).log('started', 'Bootstrap');

    const line = String(write.mock.calls[0]?.[0]);
    write.mockRestore();
    expect(JSON.parse(line)).toMatchObject({
      level: 'log',
      message: 'started',
      context: 'Bootstrap',
    });
  });
});
