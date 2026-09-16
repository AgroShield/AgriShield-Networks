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
pnpm test:contracts          # cargo test --workspace
pnpm lint:contracts          # cargo clippy --workspace --all-targets -- -D warnings
pnpm fmt:contracts           # cargo fmt --all -- --check
pnpm check:release-profile   # builds the release profile for wasm32
pnpm check:wasm-reproducible # rebuilds the wasm elsewhere and compares hashes
```

The contracts build for `wasm32-unknown-unknown` (see `rust-toolchain.toml`).
Every contract is `no_std` and returns a typed error code rather than trapping,
so callers and the backend get a deterministic reason a call failed.

## Checks

CI runs the commands above, plus `pnpm typecheck` and `pnpm test` for the backend
and the frontend, so every one of them is reproducible locally.

The one worth naming is the release-profile build, because nothing else covers it.
Every value in `[profile.release]` is a rustc codegen option, and rustc only reads
the table while compiling in that profile: `cargo metadata` exits zero regardless
of what the table says, and no test or debug build opens it at all. A typo
therefore waits for the release build a deployment runs — which is how
`strip = "symbol"` (rustc wants `symbols`) sat in this repository. Building it on
every push moves that failure to where it can still be fixed cheaply.

The reproducibility check covers the other direction. A deployed contract is
only checkable if rebuilding its source produces the same bytes, so the script
builds the wasm a second time in a different target directory and compares the
hashes; a disagreement means an artefact can no longer be traced back to the
source it claims to be. It passes because the release profile strips symbols and
debug info, which keeps the target directory's path out of the binary — the
usual reason two builds of identical sources differ.

## Deploying to testnet

`scripts/deploy-testnet.sh` deploys the four contracts and wires them together.
It needs the [Stellar CLI](https://developers.stellar.org/docs/tools/cli) on
`PATH`, and `--dry-run` prints every command without touching a network.

| Variable | Required | Meaning |
| --- | --- | --- |
| `STELLAR_SOURCE` | yes | the admin's identity name or secret key; it signs every call |
| `ADMIN_ADDRESS` | yes | the admin's `G...` address, belonging to that source |
| `PREMIUM_TOKEN_ID` | yes | the token the registry escrows and the pool custodies, as `C...` |
| `ORACLE_THRESHOLD` | yes | distinct signers a reading needs to finalize, between 1 and the signer count |
| `ORACLE_SIGNERS` | yes | the authorised signers, space separated, at most 15 |
| `MIN_SOLVENCY_RATIO_BPS` | no | floor the pool enforces on withdrawals, `1..=1000000` (default `12000`) |
| `STELLAR_NETWORK` | no | a network the CLI knows, or a passphrase (default `testnet`) |
| `ENV_OUT` | no | file to append the resulting addresses to |

```bash
STELLAR_SOURCE=admin ADMIN_ADDRESS=G... PREMIUM_TOKEN_ID=C... \
  ORACLE_THRESHOLD=2 ORACLE_SIGNERS="G... G... G..." \
  ./scripts/deploy-testnet.sh
```

The wiring order is forced rather than chosen. The registry and the pool each
refuse a payout unless the caller is the engine address they were told about, so
neither can be pointed anywhere until the engine exists; the engine's own
`initialize` then takes all three of the others. The engine is therefore deployed
before it is registered, and initialized last.

A threshold above the signer count is rejected before anything is deployed,
because it is unsatisfiable: the oracle would accept submissions and finalize
nothing. The script is not idempotent — each run deploys a fresh set of contracts
— and it prints the four addresses in the shape `backend/.env` expects, appending
them to `ENV_OUT` when that is set.
