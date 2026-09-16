## What this changes

<!-- One or two sentences. What was wrong or missing, not a list of files. -->

## Why

<!--
The reasoning a reviewer cannot get from the diff: why this approach rather
than the obvious one, and what the alternative would have cost. If it fixes an
issue, link it.
-->

Closes #

## How this was verified

<!--
What you actually ran or observed. Be precise about the boundary: "all contract
tests pass" and "settled a real policy on testnet" are different claims, and the
second is worth much more. If something could not be verified, say so here
rather than leaving it implied — an honest gap is easy to work with.
-->

- [ ] `pnpm test`
- [ ] `pnpm typecheck`
- [ ] `pnpm fmt:contracts`
- [ ] `pnpm lint:contracts`

<!-- Uncheck what does not apply rather than leaving it ticked. -->

## Reviewer notes

<!--
Anything worth pointing at: a decision you were unsure about, a piece of the
diff that looks wrong but is not, a follow-up you deliberately left out.
Delete this section if there is nothing.
-->

---

<!--
Reminders, not requirements:

* Money-moving code — anything that changes what a farmer is paid, what the pool
  holds, or when a policy settles — needs its reasoning written down here.
* A behaviour change needs a test that fails without it.
* Contracts build for `wasm32v1-none`. See the comment in rust-toolchain.toml
  for why `wasm32-unknown-unknown` cannot be used.
* If this moves the cost of a hot path, the guards in
  `contracts/*/src/tests/fees.rs` will fail, and the numbers and the explanation
  in those files should move with it.
* Never commit a key. `.env` and `deployed-addresses.local.json` are ignored;
  a secret that reaches a commit is compromised even if the commit is reverted.
-->
