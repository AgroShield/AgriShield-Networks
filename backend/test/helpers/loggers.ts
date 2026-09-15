/**
 * Loggers for tests.
 *
 * The keeper's log output is part of its behaviour — a sweep that reports every
 * settled policy as an incident would be unusable — so these let a test assert
 * on what was quiet and what was not.
 */

import type { KeeperLogger } from '../../src/keeper/keeper.js';

/** A logger that discards everything. */
export const silentLogger: KeeperLogger = {
  info(): void {},
  warn(): void {},
  error(): void {},
};

export interface RecordingLogger extends KeeperLogger {
  readonly infoCalls: object[];
  readonly warnCalls: object[];
  readonly errorCalls: object[];
}

/** A logger that records each call's payload. */
export function recordingLogger(): RecordingLogger {
  const infoCalls: object[] = [];
  const warnCalls: object[] = [];
  const errorCalls: object[] = [];

  return {
    infoCalls,
    warnCalls,
    errorCalls,
    info(payload: object): void {
      infoCalls.push(payload);
    },
    warn(payload: object): void {
      warnCalls.push(payload);
    },
    error(payload: object): void {
      errorCalls.push(payload);
    },
  };
}
