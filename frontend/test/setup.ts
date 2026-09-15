import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Testing Library registers its own cleanup only when a global `afterEach`
 * exists, and this project imports its test globals explicitly rather than
 * enabling them globally — so the hook is registered here instead. Without it a
 * second test in a file would find the first test's DOM still mounted.
 */
afterEach(() => {
  cleanup();
});
