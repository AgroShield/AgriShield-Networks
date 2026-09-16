# Contributing to AgriShield

Thanks for looking. This document is meant to be enough to get a change from an
idea to a merged pull request without reading anything else first.

AgriShield is parametric weather micro-insurance for smallholder farmers, built
on Stellar/Soroban. Four contracts hold the protocol; a backend service indexes
them and a React console reads that service.

## Contents

- [Setting up](#setting-up)
- [What the checks are](#what-the-checks-are)
- [Where things live](#where-things-live)
- [Finding something to work on](#finding-something-to-work-on)
- [Conventions](#conventions)
- [Opening a pull request](#opening-a-pull-request)
- [Reporting a bug or a vulnerability](#reporting-a-bug-or-a-vulnerability)

## Setting up

You need Node 20.11+, pnpm 11, and a Rust toolchain. `rust-toolchain.toml` pins
the toolchain, its components and the wasm target, so `rustup` installs what is
needed the first time you run `cargo` in the repository — you should not have to
install a target by hand.

```bash
pnpm install
pnpm test            # every suite: contracts, backend, frontend
pnpm typecheck       # TypeScript, all packages
```

Contracts build for `wasm32v1-none`, **not** `wasm32-unknown-unknown`. That is
not a preference: Rust 1.82 enabled the `reference-types` and `multivalue` wasm
proposals by default for `wasm32-unknown-unknown`, and the Soroban runtime
enables neither, so a module built for that target is rejected when a network
tries to run it. Nothing local catches it, because the module is valid wasm and
every test passes. See the comment in `rust-toolchain.toml`.

## What the checks are

CI runs the same commands you can, so a green local run is the quickest way to a
green pull request.

| Command | What it does |
|---|---|
| `pnpm test:contracts` | the Rust test suite for all four contracts |
| `pnpm test` | the contract, backend and frontend suites |
| `pnpm typecheck` | `tsc --noEmit` across the packages |
| `pnpm lint:contracts` | `cargo clippy --workspace --all-targets -- -D warnings` |
| `pnpm fmt:contracts` | `cargo fmt --all -- --check` |
| `pnpm check:release-profile` | builds the release profile for the wasm target |
| `pnpm check:wasm-reproducible` | rebuilds and compares artefact hashes |

Two of those deserve a note. `check:release-profile` exists because a
`[profile.release]` value is read only by rustc while compiling that profile:
`cargo metadata` accepts a bad value without complaint and no test run ever opens
the table, so the mistake otherwise waits for a deployment.
`check:wasm-reproducible` exists so a deployed artefact can be traced back to
the source it claims to be.

Please keep `cargo clippy -D warnings` clean rather than adding an `allow`. If a
lint is genuinely wrong for a line, an `allow` with a comment saying why is fine.

### Fee budgets

`contracts/*/src/tests/fees.rs` pins the CPU cost of the paths that run most
often, using the test budget's instruction counter. These are assertions, not
benchmarks: Soroban charges for the work an invocation does, and a change that
reintroduces an unnecessary storage read or cross-contract call should fail a
test rather than appear on a farmer's bill. If your change legitimately costs
more, update the numbers *and* the explanation of why, because the comment is
the part a reviewer reads.

## Where things live

```
contracts/          the four Soroban contracts, each with its own tests
  policy-registry/  mints policies, escrows premiums, owns policy state
  oracle-adapter/   N-of-M signer consensus over weather index readings
  payout-engine/    decides and executes settlement; holds no funds
  premium-pool/     custodies capital and enforces the solvency floor
backend/            the TypeScript indexer and API the console reads
frontend/           the React console
scripts/            deploy, smoke test and the build/artefact checks
```

Each contract's `src/lib.rs` opens with the invariants it holds and the trust
model it assumes. Read that before changing behaviour — most of the surprising
code in this repository is enforcing one of those invariants.

## Finding something to work on

Issues labelled `good first issue` need no context beyond the file they name.
`help wanted` means the maintainers agree the change is right but have not had
time to write it. If an issue is unclear, ask on the issue before starting — a
question costs less than a pull request that solves the wrong problem.

For anything larger than a bug fix, please open an issue first so the approach
can be agreed before the code is written.

See [docs/TRIAGE.md](docs/TRIAGE.md) for how issues are labelled and what
response to expect.

## Conventions

**Commit messages** follow [Conventional Commits](https://www.conventionalcommits.org/):
`type(scope): summary` in the imperative mood. Types in use are `feat`, `fix`,
`perf`, `refactor`, `test`, `docs`, `build`, `ci` and `chore`; scope is the part
of the tree, such as `contracts`, `backend`, `frontend`, `oracle-adapter` or
`scripts`.

Write the body for the person who will read this in a year. The most useful
commit bodies in this repository say what was wrong, why the obvious approach
did not work, and how the change was verified. A body that says "fix bug" is
worth less than no body, because it costs a reader the same time and tells them
nothing.

**One logical change per commit.** Tests for a change belong with it.

**Tests.** A behaviour change needs a test that fails without it. Contracts in
particular are worth testing at the boundaries — the invariants in `lib.rs` are
usually where the interesting cases are.

**Money-moving code.** Anything that changes what a farmer is paid, what the
pool holds, or when a policy settles needs the reasoning written down in the
commit body or the pull request. Say what you verified and, if something could
not be verified, say that too.

**Comments explain why.** The code already says what it does. The comments worth
writing explain why it is that way and why the alternative was rejected.

**Formatting.** `cargo fmt` for Rust, and the TypeScript is formatted the way it
is; match the surrounding code rather than reformatting a file you are not
otherwise changing.

## Opening a pull request

1. Fork, branch from `main`, and make the change.
2. Run the checks that apply: `pnpm test`, `pnpm typecheck`, `pnpm fmt:contracts`
   and `pnpm lint:contracts`.
3. Fill in the pull request template. The summary and the "how this was
   verified" section are the two that matter most.
4. Expect review comments on the approach, not only on the code.

A pull request is ready to merge when the checks are green, the review comments
are addressed or answered, and any behaviour change has a test.

If you cannot run part of the suite — no network, no testnet account — say so
explicitly in the pull request rather than leaving it implied. An honest
"verified locally, not against testnet" is much easier to work with than a claim
that turns out to be narrower than it sounded.

## Reporting a bug or a vulnerability

Bugs: open an issue; the template asks for what you did, what happened and what
you expected.

Security: **do not open a public issue.** See [SECURITY.md](SECURITY.md).
