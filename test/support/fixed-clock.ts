import { Clock } from '../../src/common/clock/clock.js';

/** A clock that stands still until a test moves it. */
export class FixedClock extends Clock {
  constructor(private current: Date) {
    super();
  }

  now(): Date {
    return this.current;
  }

  set(instant: Date): void {
    this.current = instant;
  }
}
