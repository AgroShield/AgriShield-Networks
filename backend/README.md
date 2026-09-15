# @agrishield/backend

The off-chain half of AgriShield: a read-through HTTP API over the four Soroban
contracts, plus the settlement keeper that pushes claims through.

There is deliberately no database yet. Every endpoint reads the chain through
`simulateTransaction`, so the API can never disagree with the contracts it is
reporting on. An index can be added later for querying history; it is not needed
to answer "what is this policy and would it pay?".

## Running it

```bash
cp .env.example .env     # fill in the RPC URL and the four contract addresses
pnpm --filter @agrishield/backend dev      # tsx watch
pnpm --filter @agrishield/backend build    # tsc -> dist/
pnpm --filter @agrishield/backend test     # vitest
pnpm --filter @agrishield/backend typecheck
```

The process exits with code 78 and a message naming the offending variable if the
configuration is incomplete or malformed, so a bad deploy fails at boot rather
than at the first settlement.

## Endpoints

All chain integers (`u64`, `i128`) are returned as **decimal strings**. They do
not fit a JavaScript number, and `JSON.stringify` cannot serialise a `bigint` at
all, so strings are the only representation that is exact for every value.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness, the latest ledger, and whether the engine's on-chain wiring matches this deployment's configuration. |
| `GET` | `/policies?farmer=G...` | Every policy id for a farmer, with the newest hydrated. |
| `GET` | `/policies?region=ng_kaduna` | The same, by region. |
| `GET` | `/policies/:policyId` | One policy. |
| `GET` | `/policies/:policyId/settlement` | What settlement would do right now, without doing it. |
| `POST` | `/settlements/:policyId` | Submit a settlement. Needs a keeper key. |
| `GET` | `/settlements/keeper` | Keeper status: cursor, totals and the last sweep. |

`?limit=` (1–100, default 20) bounds how many policies `/policies` hydrates. The
full id list is always returned alongside, so a client can page without the API
having to guess.

### Examples

```jsonc
// GET /policies/7
{
  "id": "7",
  "farmer": "GBZX...",
  "regionId": "ng_kaduna",
  "coverageStart": "1700000000",
  "coverageEnd": "1705000000",
  "triggerThreshold": "300",
  "payoutAmount": "4000",
  "premium": "1000",
  "status": "Active",
  "createdAt": "1699000000",
  "settledAt": "0"
}
```

```jsonc
// GET /policies/7/settlement   — a preview, nothing moves
{ "policyId": "7", "status": "Paid", "indexValue": "120",
  "readingTimestamp": "1700000000", "payoutAmount": "4000" }
```

```jsonc
// POST /settlements/7
{
  "transactionHash": "3f9c...",
  "ledger": 51,
  "outcome": { "policyId": "7", "status": "Paid", "indexValue": "120",
               "readingTimestamp": "1700000000", "paidAmount": "4000" }
}
```

### Errors

Every failure has the same body, so a client needs one parser:

```jsonc
{ "error": { "code": "policy_not_found", "message": "no policy exists under that id" } }
```

| Status | When |
| --- | --- |
| 400 | The request is malformed, or asked for something ambiguous (both `farmer` and `region`). |
| 404 | The chain has no such policy. |
| 409 | Well formed, but the chain is in a state that makes it impossible — already settled, window still open, policy still live. |
| 502 | A contract rejected the call with a code this build has no meaning for, or returned a shape it cannot decode. |
| 503 | The RPC node is unreachable, `POST /settlements` was called with no keeper key, or `/health` found the wiring mismatched. |

The 404/409 mappings come from the contracts' own error codes (the registry's
`PolicyNotFound` and `PolicyNotActive`, and the engine's equivalents). Codes with
no agreed meaning stay a 502 that names the contract, the method and the code, so
an unmapped failure is still diagnosable.

## The settlement keeper

Settlement is permissionless on chain: the registry and the pool each check that
the *calling contract* is their registered engine and nothing else. The keeper is
that caller. On every interval it:

1. reads the policy count;
2. takes the next slice of ids from a rolling cursor;
3. asks the engine's `evaluate` what each policy would do;
4. submits `settle_policy` only where the answer is `Paid` or `Expired`.

Design points worth knowing:

- **It never guesses.** The decision comes from the same read-only entry point the
  API exposes, backed by the same pure rule on-chain settlement uses, so a sweep
  with nothing due submits nothing and costs no fees.
- **It submits sequentially.** Transactions from one account are ordered by
  sequence number, so concurrency here buys reorgs, not speed.
- **The loop is the retry.** A failed submission leaves the policy `Active` on
  chain, and a later sweep picks it up. There is no in-sweep retry.
- **The cursor rotates.** Passes walk forward from the oldest policy and wrap at
  the newest, covering the whole book over time without a database to remember
  where they stopped. A book large enough for that to be slow wants an index, not
  a bigger batch.
- **A settled or expired policy is not an incident.** `evaluate` returns a
  conflict for a policy that has left the book, which the keeper records as
  `skipped` — otherwise every settled policy would be reported as a failure on
  every subsequent sweep, forever.

`POST /settlements/:policyId` is not a "force settle": it calls the same engine
function, which re-derives the decision on chain. An operator cannot use it to pay
a policy the index has not triggered.

## Layout

```
src/
  config.ts        environment parsing, validated at boot
  errors.ts        AppError and the HTTP status vocabulary
  contracts/
    gateway.ts     the only file that talks to Soroban RPC
    types.ts       domain types and the strict decoders that build them
    clients.ts     one typed wrapper per contract, plus error translation
  keeper/keeper.ts the sweep loop
  routes/          health, policies, settlements
  server.ts        Fastify app, routes and the single error handler
  index.ts         wiring, startup and graceful shutdown
```
