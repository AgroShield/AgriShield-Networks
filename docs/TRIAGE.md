# Triage

How issues are labelled, what the labels promise, and what happens to a report
after it arrives. The point of writing this down is that an issue should never
be a black hole: whoever files one can tell what state it is in and roughly what
to expect next.

## What happens to a new issue

1. **It gets a label.** At least one `kind/` label so the type is clear, and
   `area/` labels for the parts of the tree it touches.
2. **It gets an answer about scope.** Either "yes, we want this", "this is a
   design discussion, see …", or "we are not going to do this, because …". A
   clear no is more useful than a quiet one, and it is fine to say no.
3. **If it is wanted but unassigned**, it stays open and is labelled `help
   wanted` once the approach is agreed. Issues that need an approach agreed
   first are labelled `needs design` instead, with a note on what decision is
   missing.

Nothing here is a promise of a deadline. It is a promise that a report gets read
and answered.

## Labels

### Kind — what sort of thing is this

| Label | Meaning |
|---|---|
| `bug` | Something behaves differently from what it is documented to do |
| `enhancement` | New capability |
| `design` | A question about how something should work, not a request to change it |
| `docs` | Documentation only |
| `question` | Not a change; someone wants to understand something |

### Area — where it lands

| Label | Covers |
|---|---|
| `area/contracts` | `contracts/**` |
| `area/backend` | `backend/**` |
| `area/frontend` | `frontend/**` |
| `area/scripts` | `scripts/**` and the deploy and check tooling |
| `area/ci` | `.github/**` |
| `area/docs` | README, CONTRIBUTING, this file |

### State — what is blocking it

| Label | Meaning |
|---|---|
| `needs design` | The approach has to be agreed before anyone writes code |
| `needs reproduction` | Cannot be confirmed without more information from the reporter |
| `blocked` | Waiting on something outside the issue |

### Contribution — who can pick it up

| Label | Meaning |
|---|---|
| `good first issue` | Needs no context beyond the file it names |
| `help wanted` | Agreed and unclaimed; maintainers have not had time to write it |

### Special

| Label | Meaning |
|---|---|
| `security` | Handled privately instead — see [SECURITY.md](../SECURITY.md) |
| `fee budget` | A change that moves the CPU cost of a hot path, so the guards in `contracts/*/src/tests/fees.rs` are involved |

## Severity

Used to order the queue, not to promise a deadline.

| Label | Meaning |
|---|---|
| `severity/high` | Value can move wrongly, settle wrongly, or stop moving |
| `severity/medium` | Wrong for some users in some conditions, with a workaround |
| `severity/low` | Cosmetic, or only reachable in a configuration nobody runs |

A `severity/high` issue on a deployment holding real value jumps the queue. So
far that has not happened: this is testnet-only and pre-1.0.

## What makes an issue easy to pick up

The `good first issue` label is a promise that the issue names what to change,
where, and what "done" looks like — so that someone can start without asking a
question first. If you are filing something and are not sure how to write it
that way, leave it off; a maintainer can add it later.

An issue is **not** a good first issue if it:

- needs a design decision;
- touches settlement, solvency or the oracle's consensus rule;
- needs a testnet key, funds, or a contract redeploy to verify.

Those are fine as issues. They are just not a good place to start.

## Closing

Issues close when the fix is merged, or when the answer is "no, and here is
why". A `needs reproduction` issue that has been silent for a while closes with a
note that it can be reopened — it is not a judgement on the report, and
reopening with the missing detail is better than leaving it open indefinitely.
