# AgriShield-Networks

AgriShield is an open-source Stellar/Soroban parametric insurance platform that
automatically pays smallholder farmers when oracle-verified weather or satellite
data confirms a drought or flood, replacing slow, fraud-prone manual claims with
fast, transparent, trigger-based payouts.

Pre-1.0, and deployed to testnet only. See [Live deployment](#live-deployment)
for the addresses, the transactions that prove they work, and the console.

| | |
| --- | --- |
| Console | **https://frontend-eight-delta-o0pj7gck3j.vercel.app** |
| Network | Stellar testnet |
| Contracts | 4 deployed, wired and initialized — [proof](#live-deployment) |
| Tests | 277 contracts · 88 backend · 28 frontend |

## Features

### Parametric cover, settled without a claim

A policy pays on an observation, not on an application. Cover is bought with a
window and a threshold; if the region's finalized index is at or below the
threshold inside that window, the farmer is paid without filing anything, and
without anyone at the insurer deciding whether to.

- **Windowed cover.** The trigger only counts readings inside
  `[coverage_start, coverage_end)`. A breach observed before cover began or after
  it closed cannot trigger payment, which is what stops a farmer buying cover
  against weather they have already seen.
- **Earliest qualifying reading decides.** Not the latest, so what a policy pays
  never depends on how many observations happened to be published afterwards.
- **Deterministic preview.** `evaluate` runs the same pure decision procedure
  settlement does, so a keeper can sweep every live policy in a region each round
  and submit only the ones that will do something. The preview cannot disagree
  with the state change it previews, because it is the same function.

### Parameters a single mispriced product cannot abuse

Validated at mint time, before anything is escrowed:

- coverage windows of 7 to 180 days — short enough to limit adverse selection
  around a known forecast, long enough to fund;
- the payout is capped at **5× the premium**, so even with a 1-in-5 trigger
  probability the worst case is break-even on premium income alone;
- one active policy per plot at a time: overlapping windows on the same
  `plot_hash` are rejected, and a plot's index is capped so the overlap scan
  stays affordable;
- premium and payout must be positive, the threshold non-negative.

### An oracle no single party can move

Readings finalize only when `threshold` distinct authorized signers submit the
same `(region, timestamp, index_value)` triple.

- **A vote cannot be split.** A signer submitting a different value for the same
  instant is rejected rather than silently forming a second consensus.
- **Readings are monotonic.** An older observation can never overwrite newer
  state.
- **A pair finalizes at most once**, and re-submissions afterwards are refused.
- **History is bounded** per region, so a publisher cannot grow storage without
  bound, and **the signer set is capped** at 15 so the approval handshake stays
  cheap to verify.
- **The threshold cannot be made unsatisfiable.** Removing a signer that would
  leave the threshold unreachable reverts, because that would permanently freeze
  the region's settlements.

### Money that cannot be quietly moved

- **The engine holds nothing.** It has no funds and no authority of its own; it
  can only do what the registry and the pool permit a *registered* engine to do.
- **Callers are verified as contracts, not named.** The registry and the pool
  each check that the invoking contract *is* their registered engine, which a
  contract address can only satisfy by being in the call stack — so settlement
  cannot be forged by passing an address.
- **Reserves are real.** The pool keeps no internal ledger; its balance is the
  contract's own token balance, so accounting cannot drift from reality.
- **Committed capital is out of reach.** Admin withdrawals are rejected unless
  the solvency floor (default **120%** of outstanding liability) still holds
  afterwards. The admin cannot mint tokens and cannot pay itself.
- **Liability is bookkept per policy, exactly once**, so settling one policy
  never consumes the cover recognised for another, and a payout improves the
  pool's ratio rather than eroding someone else's.

### Settlement anyone can push, that still cannot be forged

`settle_policy` and `expire_policy` require no signature. Settlement is keeper
work, not privileged work, so a stalled operator cannot strand a claim — while
forgery stays impossible, because the contracts holding the money verify the
caller independently. Cover that expires without a trigger is retired
deterministically, releasing the capital behind it.

### Built to be cheap to run

Soroban charges for the work an invocation does, so the hot paths are held to a
budget and the budget is tested. Two examples, both measured rather than
estimated, with the guards in `contracts/*/src/tests/fees.rs`:

| Path | Before | After |
| --- | --- | --- |
| A signer's submission, region at its history cap | 1,158,557 | **541,698** CPU instructions (−53%) |
| Paying a claim | 369,707 | **308,445** CPU instructions (−17%) |

The submission path used to read every retained reading to answer a question
about a single instant; it now reads one entry. The payout path used to ask the
token contract for a balance it could already derive. Neither is visible as a
bug — both were correct, and merely expensive.

### Operable

- **Typed errors, never a trap.** Every contract is `no_std` and returns a
  deterministic reason a call failed, so the backend can tell a farmer why.
- **Events on every state change**, which is what the indexer and the console
  read.
- **A console** for policy lookup, settlement preview, oracle submission and
  keeper status.
- **Reproducible artifacts.** The wasm rebuilds to the same bytes, so a deployed
  contract can be traced back to the source it claims to be.

## Live deployment

Deployed and exercised on **Stellar testnet**. Every address below is the result
of `scripts/deploy-testnet.sh`; no step was done by hand.

### Console

**https://frontend-eight-delta-o0pj7gck3j.vercel.app**

The interface is live and current. It is served **without a backend**: the
console is a static build on Vercel, and no instance of `backend/` is deployed,
so its data panels report the API as unreachable and show their error state
rather than figures. That is a deliberate choice about scope, not a broken
deploy — the contract views it reads are all reachable directly, and the
addresses below are what a backend would be pointed at.

### Contracts

| Contract | Address |
| --- | --- |
| `policy-registry` | [`CAN7X4RP52AOCOTZGET2XJ6ZWIAFDGKCXLRJ2N6HYB3PGOKN3FMMRGIZ`](https://stellar.expert/explorer/testnet/contract/CAN7X4RP52AOCOTZGET2XJ6ZWIAFDGKCXLRJ2N6HYB3PGOKN3FMMRGIZ) |
| `payout-engine` | [`CBRMJH34GW32J5CLR3NDVB2QRNSOHW6WCBCKPJSMDXNWQU2FX6A6IVSB`](https://stellar.expert/explorer/testnet/contract/CBRMJH34GW32J5CLR3NDVB2QRNSOHW6WCBCKPJSMDXNWQU2FX6A6IVSB) |
| `premium-pool` | [`CBSACYW6UT34KPR5QYRUQLS6LRA6OC6IFUEHTGSBV5LF7RCMF4MPTQMS`](https://stellar.expert/explorer/testnet/contract/CBSACYW6UT34KPR5QYRUQLS6LRA6OC6IFUEHTGSBV5LF7RCMF4MPTQMS) |
| `oracle-adapter` | [`CBJANXSC7Z5DE7U5RE3UFIT2DVHSKXU6U5N2IJVK4SQ67XZYAYTWZTYU`](https://stellar.expert/explorer/testnet/contract/CBJANXSC7Z5DE7U5RE3UFIT2DVHSKXU6U5N2IJVK4SQ67XZYAYTWZTYU) |
| Premium token (AGRI, a Stellar Asset Contract) | [`CCVYQCIK6BTLOWMSQJU2A3MJ4K4MTQ2TTH2RIF5JXO2ML7ZEI36RNMA7`](https://stellar.expert/explorer/testnet/contract/CCVYQCIK6BTLOWMSQJU2A3MJ4K4MTQ2TTH2RIF5JXO2ML7ZEI36RNMA7) |

Admin: `GCMDDZLAV5HZBCAONLAE5F2SQWNWLWUFWGDLXZXGYAGN7CPA42TOZN4D`
Oracle: threshold **2** of **3** signers, `AGRI` as the premium asset, pool
solvency floor at the default 120%.

Wiring was verified by reading it back off the chain rather than trusting the
deploy script's exit code — `payout_engine()` on the registry and on the pool
both return the engine address above, and the registry's `premium_token()` is the
AGRI contract.

### Proof

Sixteen transactions deployed and initialized the set — four deploys, two
`initialize` calls, three `add_signer`s, two `set_payout_engine`s and the
engine's `initialize`:

```
237f5622ffa109bf1a8e3a9a296155547f28cf3896b1b24ccb2f3ed2d13c49b0
f3568ce5e408ce420d1556325f9812e96fc5c4b130de372fd98f327d6b88acf1
6fc4796a414598c13c84c2de4103da9a18bdcf22567b482a7a75f1a5e14191c0
bc1553986949820d7ae21a4cde1ba6349e739332d877a086215b69e8a1af5b40
68046b65fc6275348eb2f69c5fef428cf6c48a4a09fe6c3dac2edd9562c2ce1f
08e90e2f7357b29b4b54b8f5bfed809295baf3c16e21b377f00eaaee1bba2cfa
5375748b3dbbf4f77c963f0b57ee50aa3995a3ed785fc18090242f5a929d0abc
a6b663ddcfd7c0ff95ef9f7412df112658129b046c2fbf9bf4066741be3af72b
5617c8715639223eaa3b6a66a32459cd17d560b61f83e7559eb96eaf6d9e2d90
1e92ac3469534c2e87faa566e9293aaf2237a3793faf9f2dec95ed2c3d7e64fb
d60ecb1242e788589b80138ee106baac6b0db243431095790e32b0b0e01c7b20
83347851336d60de3cf4a28c8d418a578fd643ecc9a0d74c59074db80445592b
6b05680dcc4711d3e6d5acb8fa09f4342d78df6549b21375dee410f96c533aec
2c1592900aa8c061dc5f2e09a2d3f516f2356c5db455aa63b75a9d1784554dc4
73fc9456badb8491aacfedae8c90123e6758ea2efde8b75ed7080bb2304f027a
0db1110f25973380e3f2f5e3295734018d31fcbfd0014290001ff32fb5b14a0c
```

(`https://stellar.expert/explorer/testnet/tx/<hash>` for each.)

Addresses are not evidence that anything *works*, so `scripts/smoke-testnet.sh`
walks a whole policy life cycle on chain — trustline, mint, capitalise the pool,
create, two independent signer approvals, settle. It has been run three times,
and each run settled a real claim:

| Run | Policy minted | Settled |
| --- | --- | --- |
| 1 | [`69832559…`](https://stellar.expert/explorer/testnet/tx/69832559349a16a12041e2112f56be2df65b09fa97975f1eea66bdf7e6786e06) | [`29e7428b…`](https://stellar.expert/explorer/testnet/tx/29e7428bc5af1c9546a062984dcc284385a7c2bfd6711e9a88223343b75a486d) |
| 2 | [`15858221…`](https://stellar.expert/explorer/testnet/tx/15858221daea28a357e8aa272b324aa2d6c9333a9e3e54ca883268bbbe83d29a) | [`04de0d41…`](https://stellar.expert/explorer/testnet/tx/04de0d418300d6b880eb476eb152a93a5a3a7798c20aa48a36424d66acb6af6c) |
| 3 | [`58e844a9…`](https://stellar.expert/explorer/testnet/tx/58e844a979c559b214530ae1f78abc7393117e4dd261d645bbe370ed5684b08d) | [`c6285a75…`](https://stellar.expert/explorer/testnet/tx/c6285a75445df210b1b5cfd0c479c6a13ebb9511109e7de6bda5e40e5992d91a) |

What the settlement transaction actually did, read off the events it emitted:

- the pool released **4,000 AGRI** to the farmer and reported
  `reserves_after: 192000`, `remaining_liability: 0`;
- the registry recorded the policy `Settled` (`status: 1`) with a `settled_at`;
- the engine emitted `paid` with the deciding reading's index value and
  timestamp;
- the farmer's balance went **1,000 → 5,000**, and `is_active` on the policy then
  returned `false`.

Two distinct signers were required for each reading. One approval alone only
opens a pending reading — the second is what finalizes it.

### Reproducing any of it

```bash
git clone https://github.com/AgroShield/AgriShield-Networks && cd AgriShield-Networks
# rust-toolchain.toml installs the toolchain and the wasm target on first cargo run

# Rebuild the deployed artifacts and check they match this source
pnpm check:wasm-reproducible

# Read the live deployment (swap in any address above)
stellar contract invoke --id CBJANXSC7Z5DE7U5RE3UFIT2DVHSKXU6U5N2IJVK4SQ67XZYAYTWZTYU \
  --network testnet -- get_threshold
stellar contract invoke --id CBSACYW6UT34KPR5QYRUQLS6LRA6OC6IFUEHTGSBV5LF7RCMF4MPTQMS \
  --network testnet -- stats
```

## How it works

The on-chain system is four Soroban contracts under `contracts/`. Each holds
exactly one kind of authority, so no single component can both decide that a
claim is due and move the money for it.

| Contract | Responsibility | Authority |
| --- | --- | --- |
| [`policy-registry`](contracts/policy-registry) | Stores policy terms, escrows the farmer's premium, owns the policy lifecycle. | Admin configures; farmers mint and cancel; only the registered engine marks a policy settled. |
| [`oracle-adapter`](contracts/oracle-adapter) | Turns independently published observations into one finalized index per region via an N-of-M signer threshold. | Admin manages signers; authorized signers publish. Never moves funds. |
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

Payment is ordered deliberately: pay, then mark settled. The other way round, a
failed transfer would leave a farmer holding a policy that reads as paid.

### Design notes

- **Cover is window-scoped, half-open.** `[coverage_start, coverage_end)`, so the
  instant two adjoining windows meet belongs to the later one and one reading can
  never pay two policies on the same plot.
- **Readings are bounded history.** The oracle retains a limited history per
  region, so a policy should be settled while the reading that decides it is
  still retained. `expire_policy` is the deterministic fallback for a window that
  has already closed.
- **Storage layout follows the paths that pay.** Per-instant reading entries
  rather than one `Vec` per region, and no second balance call on a payout — see
  [Built to be cheap to run](#built-to-be-cheap-to-run).
- **TTL extensions outlive the legal maximum.** A policy can never silently
  expire from ledger state while it is still settleable.

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
to be allowed in front of the API. The public Vercel deployment deliberately sets
neither, which is why it has no data.

## Development

```bash
pnpm test:contracts          # cargo test --workspace
pnpm lint:contracts          # cargo clippy --workspace --all-targets -- -D warnings
pnpm fmt:contracts           # cargo fmt --all -- --check
pnpm check:release-profile   # builds the release profile for the wasm target
pnpm check:wasm-reproducible # rebuilds the wasm elsewhere and compares hashes
```

The contracts build for **`wasm32v1-none`**, not `wasm32-unknown-unknown` (see the
comment in `rust-toolchain.toml`). That is not a preference: Rust 1.82 enabled the
`reference-types` and `multivalue` wasm proposals by default for
`wasm32-unknown-unknown`, and the Soroban runtime enables neither, so a module
built for that target is rejected when a network tries to run it —
`Error(WasmVm, InvalidAction)`, `reference-types not enabled`. Nothing local
catches it, because the module is valid wasm and every test passes. Passing
`-C target-feature=-reference-types` does not help either; it changes nothing
about the linked artifact.

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
hashes; a disagreement means an artifact can no longer be traced back to the
source it claims to be. It passes because the release profile strips symbols and
debug info, which keeps the target directory's path out of the binary — the
usual reason two builds of identical sources differ.

The fee guards are the third kind: `contracts/*/src/tests/fees.rs` asserts the CPU
cost of the paths that run most often, so a change that reintroduces an
unnecessary storage read or cross-contract call fails a test rather than reaching
a farmer's bill.

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
| `ORACLE_SIGNERS` | yes | the authorized signers, space separated, at most 15 |
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

### Proving the deployment works

Addresses are not evidence. `scripts/smoke-testnet.sh` drives one complete life
cycle against a deployment — trustline, mint, capitalise the pool, create a
policy, collect two signer approvals, settle — and exits non-zero unless the
farmer's balance actually moved and the registry reports the policy `Settled`.

```bash
POLICY_REGISTRY_CONTRACT_ID=C... PREMIUM_POOL_CONTRACT_ID=C... \
  PAYOUT_ENGINE_CONTRACT_ID=C... ORACLE_ADAPTER_CONTRACT_ID=C... \
  PREMIUM_TOKEN_ID=C... PREMIUM_ASSET="AGRI:G..." \
  ADMIN_SOURCE=admin ISSUER_SOURCE=issuer FARMER_SOURCE=farmer \
  ORACLE_SIGNER_SOURCES="oracle-1 oracle-2" \
  ./scripts/smoke-testnet.sh
```

Run against the deployment above, it settles a real claim — see
[Proof](#proof).

### Deploying the console

The console deploys to Vercel from the repository root. `vercel.json` builds the
`@agrishield/frontend` workspace package and serves `frontend/dist`.

```bash
vercel link --project frontend
vercel deploy --prod
```

There is deliberately no SPA rewrite. The console has no client-side router, and
a catch-all rewrite would answer `/api/*` with `index.html` — turning "the backend
is not configured" into a JSON parse error instead of a clear 404.

## Getting involved

- [CONTRIBUTING.md](CONTRIBUTING.md) — setup, the checks, commit conventions, and
  how to get a change merged.
- [docs/TRIAGE.md](docs/TRIAGE.md) — every label, what it promises, and what
  happens to an issue after it arrives.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — Contributor Covenant 2.1.
- Issues labelled **`good first issue`** need no context beyond the file they
  name, and **`help wanted`** means the approach is agreed and nobody has had
  time to write it.

## Security

Do not open a public issue for a security problem — use
[the private report form](https://github.com/AgroShield/AgriShield-Networks/security/advisories/new).
[SECURITY.md](SECURITY.md) covers what is in scope, what is deliberately not, and
the trust model, so you can tell a deliberate choice from a missing check.

Nothing here should be holding real value: this is pre-1.0 and testnet-only.

## Licence

MIT — see [LICENSE](LICENSE).
