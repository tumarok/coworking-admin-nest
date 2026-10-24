import { Injectable } from '@nestjs/common';

/** The only source of "now": SQL and services never read the system time themselves. */
export abstract class Clock {
  abstract now(): Date;
}

@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
