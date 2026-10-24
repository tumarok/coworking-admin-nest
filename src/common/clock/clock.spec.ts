import { SystemClock } from './clock.js';

describe('SystemClock', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the current time on every call', () => {
    vi.useFakeTimers({ now: new Date('2026-10-14T09:00:00.000Z') });
    const clock = new SystemClock();

    expect(clock.now().toISOString()).toBe('2026-10-14T09:00:00.000Z');

    vi.advanceTimersByTime(1500);

    expect(clock.now().toISOString()).toBe('2026-10-14T09:00:01.500Z');
  });
});
