# AgriShield-Networks
AgriShield is an open-source Stellar/Soroban parametric insurance platform that automatically pays smallholder farmers when oracle-verified weather or satellite data confirms a drought or flood, replacing slow, fraud-prone manual claims with fast, transparent, trigger-based payouts.

## Contracts

The on-chain system is four Soroban contracts under `contracts/`. Each one holds
exactly one kind of authority, so no single component can both decide that a
claim is due and move the money for it.

| Contract | Responsibility | Authority |
| --- | --- | --- |
| [`policy-registry`](contracts/policy-registry) | Stores policy terms, escrows the farmer's premium, owns the policy lifecycle. | Admin configures; farmers mint and cancel; only the registered engine marks a policy settled. |
| [`oracle-adapter`](contracts/oracle-adapter) | Turns independently published observations into one finalized index per region via an N-of-M signer threshold. | Admin manages signers; authorised signers publish. Never moves funds. |
| [`premium-pool`](contracts/premium-pool) | Custodies the risk capital and enforces a solvency floor on every exit of funds. | Admin may move surplus capital; only the registered engine may pay a claim. |
| [`payout-engine`](contracts/payout-engine) | Decides settlements and drives the cross-contract calls that pay them. | Holds no funds and no authority of its own. |

### The settlement path

1. A farmer buys cover from the registry, which escrows the premium.
2. The engine recognises the policy's payout as liability on the pool, which
   locks the capital backing it out of reach of the pool admin.
3. Signed oracle readings accumulate until a quorum finalizes an index for the
   region.
4. Anyone — a keeper, the backend, a farmer — calls `settle_policy`. The engine
   looks for a finalized reading inside the policy's coverage window whose index
   breached the threshold, and then:
   - **triggered** — the pool pays the farmer, and only then does the registry
     mark the policy settled;
   - **window closed, no trigger** — the registry expires the policy and the
     pool releases the liability;
   - **window still open** — nothing changes and the keeper retries later.

Settlement needs no signature, but it cannot be forged: the registry and the
pool each independently verify that the *calling contract* is their registered
payout engine, which a contract address can only satisfy by being in the call
stack.

### Design notes

- **Reserves are real.** The pool keeps no internal ledger; its balance is the
  token balance of the contract itself, so accounting cannot drift from reality.
- **Cover is window-scoped.** A breach observed before cover began or after it
  closed can never trigger a payment, which is what stops retroactive purchases
  against weather a farmer has already seen. The window is half-open
  (`[coverage_start, coverage_end)`), matching the registry's overlap rule: the
  instant two adjoining windows meet belongs to the later one, so one reading can
  never pay two policies on the same plot.
- **Liability is bookkept per policy, exactly once.** Settling one policy never
  consumes the cover recognised for another.
- **Readings are bounded history.** The oracle retains a limited ring per
  region, so a policy should be settled while the reading that decides it is
  still retained. `expire_policy` is the deterministic fallback for a window that
  has already closed.

## Packages

| Package | What it is |
| --- | --- |
| `contracts/` | The four Soroban contracts above; built and tested with cargo. |
| [`backend`](backend) | A read-through HTTP API over the contracts, plus the settlement keeper that pushes claims through. |
| [`frontend`](frontend) | The operator console: a React + Vite single-page app against that API. |

```bash
pnpm install
pnpm dev:backend     # http://localhost:3000
pnpm dev:frontend    # http://localhost:5173, proxying /api to the backend
pnpm typecheck && pnpm test
```

The frontend reaches the backend through a same-origin `/api` path, which the dev
server proxies and a reverse proxy serves in production — the backend sets no CORS
headers, so a browser calling it cross-origin would have its responses refused.
Pointing `VITE_API_BASE_URL` at an absolute origin works, but that origin then has
to be allowed in front of the API.

## Development

```bash
pnpm test:contracts    # cargo test --workspace
pnpm lint:contracts    # cargo clippy --workspace --all-targets -- -D warnings
pnpm fmt:contracts     # cargo fmt --all -- --check
```

The contracts build for `wasm32-unknown-unknown` (see `rust-toolchain.toml`).
Every contract is `no_std` and returns a typed error code rather than trapping,
so callers and the backend get a deterministic reason a call failed.
