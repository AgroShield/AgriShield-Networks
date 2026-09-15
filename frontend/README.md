# @agrishield/frontend

The operator console for AgriShield: a React + Vite single-page app that reads
policies, asks the settlement engine what it would do, submits settlements and
reports what the keeper has been doing — all through the backend API, with no
knowledge of Soroban at all.

## Running it

```bash
pnpm --filter @agrishield/frontend dev        # vite, http://localhost:5173
pnpm --filter @agrishield/frontend build      # tsc --noEmit && vite build
pnpm --filter @agrishield/frontend test       # vitest
pnpm --filter @agrishield/frontend typecheck

# or, from the repository root, alongside the backend
pnpm dev:backend
pnpm dev:frontend
```

No `.env` is needed for local work; `.env.example` documents the two variables
there are.

## Talking to the backend

The app's default base URL is `/api`, a same-origin path. The dev server proxies
it to the backend, which is not a convenience — the backend sets no CORS headers,
so a browser at `:5173` calling `:3000` directly would have its responses refused.
The proxy also means the deployed build is already pointing at the right shape:
static files and the API behind one host, with `/api` routed to the backend.

`VITE_API_BASE_URL` overrides it with an absolute origin. That works, but
whatever serves the API then has to allow this origin.

Vite inlines `VITE_`-prefixed variables at **build** time, so changing one needs
a rebuild rather than a restart.

## What it shows

| Endpoint | Where |
| --- | --- |
| `GET /health` | the header panel |
| `GET /policies?farmer=` / `?region=` | the policy list |
| `GET /policies/:id` | the detail panel |
| `GET /policies/:id/settlement` | the settlement preview |
| `POST /settlements/:id` | the submit button |
| `GET /settlements/keeper` | the keeper panel |

A few things about the console that are deliberate rather than incidental:

- **The preview is a preview.** `GET /policies/:id/settlement` calls the engine's
  read-only `evaluate`, which is the same rule on-chain settlement uses, so it
  says what a submission would do without doing it. `Pending` is worded as "no
  payout is due yet" rather than "cover is open", because at a window's closing
  instant the cover has ended but the registry will not yet accept an expiry, and
  the engine reports `Pending` for both.
- **Submitting is not a force-settle.** The button calls the backend, which calls
  the engine, which re-derives the decision on chain. It cannot pay a policy the
  index has not triggered, and the copy says so rather than implying the button
  decides anything.
- **A refusal is shown with its code.** `409 coverage_still_open` and
  `409 policy_not_active` are different problems, and the API's own code and
  message are surfaced instead of a generic failure.
- **A read-only deployment still works.** With no keeper key configured,
  `/health` reports it, the submit button is disabled with the reason, and every
  query still answers.
- **`/health` is read from its body, not its status.** It answers 503 for both
  "the node is unreachable" and "this process is wired to different contracts
  than the engine settles against", and in both cases the body is the report.
  Taking the status code as failure would discard the explanation that is the
  point of the endpoint.

## Two numbers that look alike

On-chain integers arrive as **decimal strings** and are formatted only at the
point of display, so nothing rounds in a layer that was not thinking about it.
They are not all the same kind of number:

- **amounts** (`payoutAmount`, `premium`, `paidAmount`) are token base units. The
  premium token is a Stellar asset contract, so they are shown divided by 10⁷ —
  a payout of `4000` is `0.0004`;
- **index readings and thresholds** (`indexValue`, `triggerThreshold`) are weather
  index values, compared against the oracle's readings. They are shown as plain
  integers, never as money.

Timestamps are Unix seconds shown in UTC, because a coverage window is a contract
term and rendering it in a browser's local zone would make two operators
disagree about when it ends.

## Layout

```
src/
  api/
    shape.ts        response-shape checks
    types.ts        domain types and the decoders that build them
    client.ts       the typed client, its error translation and one URL builder
  components/       one panel per thing on the page
  useAsync.ts       loading one request into renderable state
  format.ts         amounts, timestamps, shortened identifiers
  App.tsx           the console: state, layout, composition
  main.tsx          browser entrypoint and configuration
  styles.css        the single stylesheet
test/
  helpers/          a scripted fetch and a scripted API client
```

## Tests

`pnpm --filter @agrishield/frontend test` runs two suites:

- **`api.test.ts`** drives the client against a scripted `fetch` in the **node**
  environment, so `Response` is the real one. It covers the URL each call builds,
  the error envelope, an unreachable API (reported as status `0` rather than
  dressed up as a server answer), a body that does not decode, and `/health`'s
  503-with-a-report behaviour.
- **`app.test.tsx`** renders the console against a scripted client in jsdom and
  asserts on what an operator sees: that nothing is queried until a search is
  submitted, that a refusal shows its code, and that one policy's settlement
  outcome is not carried over to the next.

Neither suite touches a network or a chain, so a change on either side of the
HTTP boundary is caught by types and by the decoders rather than by a test that
happens to be pointed at a running node.
