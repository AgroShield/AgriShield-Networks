# AgriShield Technical Architecture & System Design

This document details the system design, contract state machines, security invariants, backend orchestration, and Web3 frontend integration across the AgriShield Networks platform.

---

## 1. High-Level Architecture Overview

AgriShield implements a decentralized, non-custodial parametric micro-insurance platform designed specifically for smallholder farmers vulnerable to climate volatility. The system decouples risk capital, policy management, oracle observations, and settlement execution into modular components.

```
                  +----------------------------------------------+
                  |         Web3 Frontend Console (React 19)      |
                  |  - Stellar Wallets Kit (Freighter / Demo)   |
                  |  - Farmer Policy Creation Modal              |
                  |  - Liquidity Reserves & Solvency Monitor     |
                  |  - Oracle Threshold Co-signer Portal         |
                  +-----------------------+----------------------+
                                          | HTTP / REST
                                          v
                  +----------------------------------------------+
                  |      Backend Service & Autonomous Keeper     |
                  |  - Fastify Gateway with Rate Limiting & CORS |
                  |  - Atomic Soroban Sequence Mutex             |
                  |  - Persistent Sweep Cursor & LRU Policy Cache|
                  |  - OpenAPI 3.0 Swagger & Prometheus Telemetry|
                  +-----------------------+----------------------+
                                          | JSON-RPC
                                          v
+----------------------------------------------------------------------------------+
|                              Stellar / Soroban Network                            |
|                                                                                  |
|  +--------------------+         +--------------------+         +---------------+ |
|  |   Policy Registry  |<------->|    Payout Engine   |<------->| Oracle Adapter| |
|  | - Terms & Escrow   |         | - Pure Evaluation  |         | - K-of-N Quorum| |
|  | - Pruning & Escrow |         | - Claim Execution  |         | - Stale Pruning| |
|  +---------+----------+         +---------+----------+         +---------------+ |
|            |                              |                                      |
|            | Accrue / Release Liability   | Execute Payout                       |
|            v                              v                                      |
|  +---------------------------------------------------+                           |
|  |                    Premium Pool                   |                           |
|  |  - Capital Reserves (USDC / AGRI)                 |                           |
|  |  - Minimum Solvency Ratio Enforcement (>= 120%)   |                           |
|  |  - Auto-Forwarded Premiums & Claim Settlements    |                           |
|  +---------------------------------------------------+                           |
+----------------------------------------------------------------------------------+
```

---

## 2. Soroban Smart Contract Architecture

The on-chain core comprises 4 `no_std` Rust smart contracts compiled to `wasm32v1-none`.

### 2.1. Policy Registry (`agrishield-policy-registry`)

- **Role:** Owns policy terms, escrows farmer premiums, tracks land plot concurrency, and enforces the policy lifecycle.
- **State Machine:**
  - `Active (0)`: Minted, escrowed, liability recognized on the pool.
  - `Settled (1)`: Payout successfully disbursed to farmer; escrowed premium forwarded to pool.
  - `Expired (2)`: Coverage window closed without breach; escrowed premium forwarded to pool; recognized liability released.
  - `Cancelled (3)`: Cancelled by farmer before start; premium refunded; liability released.
- **Key Enhancements (v0.2.0):**
  - **Premium Forwarding:** On settlement or expiration, escrowed premiums are immediately transferred to the `Premium Pool`, fortifying risk reserves.
  - **Plot Concurrency Pruning:** Inactive (settled/expired/cancelled) policies are removed from the plot's index to prevent plot lockouts.
  - **Two-Step Governance:** Admin transfers utilize `nominate_admin` and `accept_admin`.
  - **Circuit Breaker:** `pause()` and `resume()` toggle contract mutability under emergencies.
  - **WASM Upgradeability:** `upgrade(new_wasm_hash)` entrypoint for live logic upgrades.

### 2.2. Payout Engine (`agrishield-payout-engine`)

- **Role:** Pure stateless decision procedure and claim orchestrator. Holds no funds and no administrative keys over funds.
- **Multi-Directional Trigger Evaluation:**
  - `TriggerCondition::BelowOrEqual`: For drought, sub-zero frost kill, and soil moisture deficits ($V_{obs} \le T$).
  - `TriggerCondition::AboveOrEqual`: For river flood surges, excess precipitation accumulations, and extreme heatwaves ($V_{obs} \ge T$).
- **Settlement Sequencing:**
  1. Inspects policy window `[coverage_start, coverage_end)`.
  2. Queries finalized oracle observations in region.
  3. Identifies earliest qualifying reading.
  4. If breached: Calls `PremiumPool.pay_claim()`, then calls `PolicyRegistry.mark_settled()`.
  5. If expired without breach: Calls `PolicyRegistry.expire_policy()`.

### 2.3. Premium Pool (`agrishield-premium-pool`)

- **Role:** Custodies risk capital deposited by liquidity providers and enforces solvency invariants.
- **Solvency Invariant:**
  $$\text{Reserve Ratio} = \frac{\text{Active Reserves}}{\text{Recognized Liabilities}} \ge \text{Min Solvency Ratio (e.g. 120\%)}$$
- **Atomic Accounting:**
  - Policy minted: Registry notifies Pool -> Recognized Liability increases.
  - Policy settled: Pool pays claim -> Reserves decrease -> Recognized Liability decreases.
  - Policy expired/cancelled: Recognized Liability decreases.
  - Admin withdrawals are strictly reverted if $\text{Post-Withdrawal Reserves} < 1.20 \times \text{Liability}$.

### 2.4. Oracle Adapter (`agrishield-oracle-adapter`)

- **Role:** Turns multi-party environmental observations into decentralized consensus readings.
- **Consensus Handshake:** Requires $K$ distinct authorized signers ($K \le N \le 15$) to record identical observations for `(region, timestamp)`.
- **Anti-Split Voting:** Conflicting observations for the same region and timestamp are rejected.
- **Pending Reading Pruning:** Automatically discards stale unfinalized observations exceeding expiration windows.

---

## 3. Backend & Keeper Architecture

The backend (`backend/`) is a production Fastify microservice designed for mission-critical reliability:

1. **Atomic Transaction Sequence Mutex:**
   Soroban transactions require sequential account sequence numbers. When parallel requests or sweeps occur, the `SequenceMutex` serializes simulation, transaction building, and RPC dispatch, preventing `txBAD_SEQ` race collisions.

2. **Resilient Polling & Exponential Backoff:**
   Transaction status polling implements exponential backoff with jitter, handling network blips and deciphering Soroban XDR error streams (`ContractCallError`).

3. **Persistent Keeper Cursor:**
   The autonomous sweeper tracks its progress across rounds and resumes from its last cursor even after server restarts, eliminating repeated scans of ancient policies.

4. **Edge Security & Rate Limiting:**
   - In-memory sliding window IP rate limiter with `X-RateLimit-*` headers.
   - Configurable CORS allowed origins.
   - Fastify Helmet security headers (`X-Content-Type-Options`, `X-Frame-Options`).
   - Optional API key authentication for privileged settlement triggers (`x-api-key`).

5. **Observability & Interactive Docs:**
   - Swagger OpenAPI 3.0 at `/docs` and schema at `/docs/json`.
   - Prometheus scrape endpoint at `/metrics`.

---

## 4. Web3 Frontend Console

The frontend (`frontend/`) empowers farmers, liquidity providers, and oracle signers:

- **Wallet Adapter:** Modular Stellar wallet connection supporting Freighter browser extension and simulated developer accounts.
- **Policy Minting Flow:** Accessible modal with instant client-side validation of duration bounds (7-180 days) and coverage multiples ($\le 5\times$).
- **Direct Wallet Signing:** End-users can trigger transactions directly via browser wallet signatures.
- **Reserve Dashboard:** Visualizes pool capital health, solvency ratios, and total claims paid.
- **Oracle Signer Portal:** Enables threshold signers to inspect pending readings and submit co-signatures.
- **Dark/Light Mode:** Responsive theme switching honoring system defaults and local storage preference.
- **Accessible Alerts:** Polite `aria-live` toast notifications for transaction lifecycle events.

---

## 5. Security Model & Invariants

| Invariant | Enforcement Mechanism |
| --- | --- |
| No single party can forge a payout | Engine holds no funds; Pool and Registry independently assert caller contract identity. |
| Reserves cannot be drained below liabilities | Solvency ratio floor checked on every pool withdrawal. |
| Policies cannot pay twice | Registry atomically flips state to `Settled` on first payout. |
| Plot cannot be double-insured | Registry rejects overlapping coverage windows on identical `plot_hash`. |
| Admin cannot steal funds or burn keys | Two-step nomination/acceptance pattern prevents accidental burn; pool rules prevent arbitrary withdrawals. |
| Malicious oracle reading cannot trigger payout | Requires $K$-of-$N$ threshold signatures across distinct authorized keys. |
| Emergency shutdown capability | Pause switches allow immediate halt of mutations during security incidents. |
