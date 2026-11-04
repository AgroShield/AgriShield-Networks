# Changelog

Notable changes to AgriShield. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[Semantic Versioning](https://semver.org/spec/v2.0.0.html), and this project is
still pre-1.0 — the `0.x` line reserves the right to change behaviour.

## [0.2.0] - 2026-11-04

### Added

- **Multi-directional parametric triggers**: added `TriggerCondition` enum (`BelowOrEqual` for drought/frost, `AboveOrEqual` for flood/heatwave) across contracts, payout engine, backend, and frontend.
- **Automatic premium forwarding & escrow sweeps**: policy registry wires premium forwarding to the premium pool on settlement and expiration, with admin sweep recovery.
- **Dynamic liability accrual & release**: premium pool recognizes liabilities upon policy creation and releases liabilities upon cancellation or expiry.
- **Plot concurrency pruning**: automatically prunes inactive policies from the plot registry, preventing plot lockouts.
- **Two-step governance transfer**: implemented `nominate_admin` and `accept_admin` across all four smart contracts.
- **Emergency circuit breakers**: added `pause` and `resume` entrypoints across critical contract paths.
- **Live WASM upgradeability**: added `upgrade(new_wasm_hash)` entrypoints to all four contracts.
- **Soroban sequence mutex**: serialized transaction nonces in backend gateway, eliminating `txBAD_SEQ` race collisions.
- **Resilient keeper polling**: added exponential backoff, XDR error decoding, and persistent cursor tracking across server restarts.
- **Backend security & edge middleware**: rate limiting, CORS configuration, security headers, and optional API key authentication for settlement endpoints.
- **OpenAPI & Observability**: integrated interactive Swagger UI at `/docs`, OpenAPI 3.0 schema at `/docs/json`, and Prometheus metrics at `/metrics`.
- **Web3 Wallet Integration**: Stellar Wallets Kit support (Freighter & simulated Web3 demo account) in frontend with live account state.
- **Farmer Policy Creation Modal**: self-service policy creation with live parameter validation, coverage multiple checks, and duration bounds.
- **Direct Wallet Signing**: direct client-side signing for policy settlements and cancellations.
- **Liquidity Pool & Solvency Dashboard**: live monitoring of pool reserves, liabilities, and reserve ratios with deposit capability.
- **Oracle Signer Portal**: co-signature management interface for multi-party environmental observations.
- **Accessibility & UX**: non-intrusive toast notifications and Light/Dark theme switching.
- **Docker & DevOps**: multi-stage Dockerfiles for backend and frontend, root `docker-compose.yml`, and automated local devnet sandbox scripts (`setup-local-sandbox.sh` and `.ps1`).
- **Comprehensive Architecture Documentation**: created `docs/ARCHITECTURE.md`.

## [0.1.1] - 2026-10-20

### Fixed

- **Every nested API path returned a platform 404 in production.** Vercel's
  `api/[...path].ts` convention generates a route matching a single path segment,
  so `/api/health` and `/api/policies` worked while `/api/policies/{id}`,
  `/api/policies/{id}/settlement`, `POST /api/settlements/{id}` and
  `/api/settlements/keeper` never reached the function at all - the console's
  detail and settlement panels were dead in production. Fixed with an explicit
  splat rewrite to the catch-all file in `backend/vercel.json`. Only reachable
  against a real deployment; the test suite exercises the app in-process, where
  routing is not Vercel's.
- **The contracts could not be deployed anywhere.** They were built for
  `wasm32-unknown-unknown`, which the Soroban runtime rejects because Rust 1.82
  enabled the `reference-types` and `multivalue` wasm proposals by default for
  that target. `wasm32v1-none` is now pinned in `rust-toolchain.toml`. Nothing
  local could catch it: the module compiles, every test passes and the release
  profile is satisfied — the rejection only happens when a network runs it.

### Changed

- **A signer's submission is 53% cheaper on a busy region.** The oracle kept each
  region's history as one `Vec<IndexReading>`, so every submission read the whole
  retained history to answer "is this timestamp already finalized?" and every
  finalization rewrote it. History is now one entry per retained instant plus a
  small index of their timestamps. Measured at the 64-reading cap: 1,158,557 →
  541,698 CPU instructions. On a region with a single reading the cost is
  unchanged, which is the point — it no longer tracks history size.
- **Paying a claim is 17% cheaper.** The pool asked the token contract for its
  balance twice: once to enforce the reserve floor and again to report the
  post-transfer figure in its event. The transfer just made is the only thing
  that can move the balance inside that call, so the second cross-contract call
  is derived instead. Measured: 369,707 → 308,445 CPU instructions.

  Both changes are behaviour-preserving. The oracle still distinguishes a retained
  reading from one that has aged out, and the pool's reported balance is still
  exactly the token's own answer — which is asserted against the token contract
  rather than assumed.

### Added

- `scripts/smoke-testnet.sh`: drives a complete policy life cycle against a
  deployment and exits non-zero unless the farmer's balance moved and the registry
  reports the policy `Settled`. A deployed address is not evidence that anything
  works.
- Fee regression guards in `contracts/*/src/tests/fees.rs`, which hold the two
  numbers above in place.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue forms, a pull
  request template, `docs/TRIAGE.md` and Dependabot configuration.
- `vercel.json`, so the console builds from the workspace root.
- A two-minute pitch video, attached to the v1.0.0 release and linked from the
  README. `docs/video/` holds the pipeline that produces it, so the recording is
  regenerated from the deployed system rather than re-edited by hand: the console
  footage is captured from the live deployment, the callout positions are measured
  from its DOM, and the narration timings drive the edit.

### Deployed

- All four contracts, wired and initialized, on Stellar testnet, with a full
  policy life cycle settled end to end. Addresses, transaction hashes and the
  console link are in the [README](README.md#live-deployment).

## [0.1.0] - 2026-09-15

### Added

- `policy-registry`, `oracle-adapter`, `premium-pool` and `payout-engine`, with
  their invariants documented at the top of each `src/lib.rs`.
- The backend API and settlement keeper, and the React operator console.
- CI for the contract suites, the package suites, rustfmt, clippy, the release
  profile and artifact reproducibility.
