# Security policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.** A public report
tells everyone how to exploit it before there is a fix.

Use GitHub's private reporting instead: **Security → Report a vulnerability** on
this repository. That opens a private advisory visible only to the maintainers
and to you.

Please include what you can of:

- the contract, entry point and, if you have one, a transaction hash or a failing
  test that shows the problem;
- what an attacker gains, and who loses;
- whether it is reachable on a deployment you do not control, or needs admin
  authority first.

We will acknowledge the report, tell you whether we agree it is a vulnerability,
and keep you updated on the fix. If you would like credit in the advisory, say
so and how you would like to be named.

## What is in scope

The four Soroban contracts in `contracts/` are the security boundary. Anything
that lets value move, or stop moving, in a way the documented invariants forbid
is in scope. In particular:

- paying a policy that should not pay, paying twice, or paying an amount the
  policy's own terms do not allow;
- releasing pool capital that backs a live policy;
- forging, or preventing, the finalization of an oracle reading;
- stealing or stranding escrowed premiums;
- permanently freezing settlements, for example by making a threshold
  unsatisfiable or a region's history unusable.

The backend and frontend are in scope where they hold authority or mislead a
user about it — a forged signature, a settlement decision reported as final that
the contract would refuse, or a claim about the chain that the chain does not
support.

## What is not in scope

- Issues in a deployment we do not operate. The testnet addresses in the README
  are a demonstration; anyone can point their own contracts at the same code.
- The console or the API being unavailable, slow, or showing an error for a
  backend that is not configured. The public deployment runs the interface
  without a backend on purpose.
- Denial of service by paying network fees. Every entry point that a stranger can
  call is priced accordingly, and griefing by fee is not treated as a protocol
  bug — but a *cheap* way to make settlement unaffordable is in scope, so please
  report it.
- Findings from an automated scanner with no demonstrated impact.

## Trust model, briefly

Worth knowing before you spend time on a report, because much of what looks like
a missing check is a deliberate choice:

- **No single party can move money.** A reading finalizes only when `threshold`
  distinct signers submit the same `(region, timestamp, index_value)` triple. A
  signer that disagrees cannot split the vote.
- **The payout engine holds no funds and has no authority of its own.** It can
  only do what the registry and the pool permit a *registered* engine to do, and
  each of those checks the calling contract itself rather than trusting an
  argument.
- **Settlement is permissionless, and that is intended.** Any keeper may settle
  or expire a policy. Forgery is still impossible, because the contracts that
  hold the money verify the caller independently.
- **The admin can move surplus capital, not committed capital.** Withdrawals are
  rejected unless the solvency floor still holds afterwards. The admin cannot
  mint tokens, cannot pay itself, and cannot change a policy's terms.

The invariants each contract is built to hold are listed at the top of its
`src/lib.rs`. If you believe one of them is wrong, that is a design discussion
worth opening as a normal issue rather than a private report.

## Supported versions

This is pre-1.0 and deployed only to testnet. Fixes go to `main`; there are no
maintained release branches. Nothing here should be holding real value, and if
you find a deployment that is, that is itself worth reporting.
