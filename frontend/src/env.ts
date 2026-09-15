/**
 * Resolving the API's base URL.
 *
 * Kept out of `main.tsx` because it is the one piece of configuration the app
 * has, and a wrong answer here is indistinguishable from the API being down. A
 * trailing slash is stripped so that joining a path never produces `//policies`,
 * which some proxies match and some do not.
 */

/** What a build with no configuration talks to: the same origin, under `/api`. */
export const DEFAULT_BASE_URL = '/api';

/**
 * Normalises a configured base URL.
 *
 * A blank or whitespace-only value is the same as no value: `VITE_API_BASE_URL=`
 * in a `.env` file should mean "use the default", not "send every request to the
 * current page".
 */
export function apiBaseUrl(configured: string | undefined): string {
  const trimmed = (configured ?? '').trim().replace(/\/+$/, '');
  return trimmed === '' ? DEFAULT_BASE_URL : trimmed;
}
