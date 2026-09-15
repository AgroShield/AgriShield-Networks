/**
 * Turning chain values into something readable.
 *
 * All of this happens at the point of display and nowhere earlier: the API
 * returns exact integer strings and the app keeps them that way, so a value can
 * only be rounded in a layer whose whole job is presentation.
 */

/**
 * The premium token is a Stellar asset contract, and those have seven decimals.
 *
 * The contract suite's own fixtures say so — the registry test wallet is funded
 * with "100k premium-token units (7 decimals)" — which is why a payout of
 * `4000` on chain is `0.0004` in the units an operator thinks in.
 */
export const TOKEN_DECIMALS = 7;

const SCALE = 10n ** BigInt(TOKEN_DECIMALS);

/**
 * Formats an amount in the token's whole units.
 *
 * Trailing zeros are trimmed but at least two decimals are kept, so a column of
 * amounts lines up and `1.5` reads as money rather than as a ratio. The value
 * itself is never rounded: the full seven decimals are shown whenever they are
 * not zero.
 */
export function formatTokenAmount(raw: string): string {
  let value: bigint;
  try {
    value = BigInt(raw);
  } catch {
    return raw;
  }

  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const whole = magnitude / SCALE;
  const fraction = (magnitude % SCALE).toString().padStart(TOKEN_DECIMALS, '0');
  const trimmed = fraction.replace(/0+$/, '');
  const shown = trimmed.length < 2 ? fraction.slice(0, 2) : trimmed;

  return `${negative ? '-' : ''}${whole}.${shown}`;
}

/** The exact integer as sent, for a `title` attribute or a secondary line. */
export function stroopsLabel(raw: string): string {
  return `${raw} in base units`;
}

/**
 * Formats a chain timestamp, which is seconds since the Unix epoch.
 *
 * Rendered in UTC and marked as such: a coverage window is a contract term, and
 * showing it in a browser's local zone would make two operators reading the same
 * policy disagree about when it ends.
 */
export function formatTimestamp(raw: string): string {
  let seconds: bigint;
  try {
    seconds = BigInt(raw);
  } catch {
    return raw;
  }

  const date = new Date(Number(seconds) * 1000);
  if (Number.isNaN(date.getTime())) return raw;

  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}Z`;
}

/**
 * Formats a wall-clock millisecond timestamp.
 *
 * The sweep report's timestamps are the only ones the backend produces itself,
 * so they arrive as JSON numbers rather than as chain seconds, and they are the
 * only timestamps here that are not contract data.
 */
export function formatClock(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return String(ms);
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}Z`;
}

/** The sentinel the registry stores in `settledAt` while a policy is live. */
export function isUnset(timestamp: string): boolean {
  return timestamp === '0';
}

/** A coverage window, which is the term an operator most often needs to check. */
export function formatWindow(start: string, end: string): string {
  return `${formatTimestamp(start)} → ${formatTimestamp(end)}`;
}

/**
 * Shortens a long identifier for a table cell, keeping both ends.
 *
 * Strkeys and hashes are only meaningful when compared by eye against another
 * copy of the same value, so the first and last few characters are what has to
 * survive; the full value belongs in a `title`.
 */
export function shorten(value: string, leading = 6, trailing = 4): string {
  if (value.length <= leading + trailing + 1) return value;
  return `${value.slice(0, leading)}…${value.slice(-trailing)}`;
}

/** `1 policy` / `2 policies`, so a sentence never reads `1 policies`. */
export function pluralise(amount: number, one: string, many: string): string {
  return amount === 1 ? one : many;
}
