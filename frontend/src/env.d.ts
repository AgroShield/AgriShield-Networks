/// <reference types="vite/client" />

/**
 * The environment variables this app reads.
 *
 * Vite inlines every `VITE_`-prefixed variable into the bundle at build time, so
 * these are build-time constants rather than runtime configuration: changing one
 * needs a rebuild, not a restart. Declaring them here means a typo in a variable
 * name fails the typecheck instead of quietly reading `undefined`.
 */
interface ImportMetaEnv {
  /** Where the browser sends API requests. Defaults to `/api`. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
