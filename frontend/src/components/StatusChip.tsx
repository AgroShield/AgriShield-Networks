import type { ReactElement } from 'react';

export type Tone = 'neutral' | 'good' | 'warn' | 'bad';

export interface StatusChipProps {
  readonly label: string;
  readonly tone?: Tone;
}

export function StatusChip({ label, tone = 'neutral' }: StatusChipProps): ReactElement {
  return <span className={`chip chip--${tone}`}>{label}</span>;
}

/**
 * Colour by what a status means, not by which enum it came from.
 *
 * Four vocabularies arrive here — a policy's lifecycle, a settlement's
 * conclusion, a sweep entry's action and the health endpoint's own condition —
 * and `Expired` and `failed` mean the same kind of thing while `Settled` and
 * `completed` do not mean anything at all. One table keeps them consistent
 * instead of each panel inventing its own palette.
 */
const TONES: Readonly<Record<string, Tone>> = {
  // policy-registry
  Active: 'good',
  Settled: 'neutral',
  Expired: 'warn',
  Cancelled: 'bad',
  // payout-engine
  Paid: 'good',
  Pending: 'neutral',
  // keeper sweep entries
  settled: 'good',
  skipped: 'neutral',
  expired: 'warn',
  failed: 'bad',
  // /health
  ok: 'good',
  degraded: 'warn',
  down: 'bad',
};

/** Falls back to neutral so an unseen status renders rather than crashing. */
export function toneFor(name: string): Tone {
  return TONES[name] ?? 'neutral';
}
