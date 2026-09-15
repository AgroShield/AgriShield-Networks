/**
 * Browser entrypoint.
 *
 * Configuration is resolved once here and injected into the app rather than
 * read from inside components, so every component takes what it needs as a
 * prop and a test can render the console against a scripted client with no
 * environment and no server.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { createApiClient } from './api/client';
import { apiBaseUrl } from './env';
import './styles.css';

const container = document.getElementById('root');
if (container === null) {
  // The only thing `index.html` has to provide. Failing loudly here is better
  // than a blank page with nothing in the console.
  throw new Error('#root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App client={createApiClient({ baseUrl: apiBaseUrl(import.meta.env.VITE_API_BASE_URL) })} />
  </StrictMode>,
);
