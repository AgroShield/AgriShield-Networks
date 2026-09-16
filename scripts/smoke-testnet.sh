#!/usr/bin/env bash
#
# Drives one complete policy life cycle against an already-deployed set of
# contracts, so a deployment can be shown to work rather than merely to exist.
#
# A deployed address is not evidence that anything functions: the four contracts
# are useless together unless they are wired to each other, the premium token is
# funded, and the oracle can actually finalize a reading. Each of those is a
# separate transaction that can fail on its own, and `deploy-testnet.sh` cannot
# exercise any of them because a policy needs a farmer, a funded pool and two
# signers. This walks the whole path once:
#
#   trustline -> mint premium -> capitalise the pool -> create a policy
#   -> two signers agree on a breaching reading -> settle -> the farmer is paid
#
# Nothing about it is idempotent. Run it against a throwaway deployment.
#
# Required environment:
#   POLICY_REGISTRY_CONTRACT_ID, PREMIUM_POOL_CONTRACT_ID,
#   PAYOUT_ENGINE_CONTRACT_ID, ORACLE_ADAPTER_CONTRACT_ID
#                          the deployment to exercise (see deploy-testnet.sh)
#   PREMIUM_TOKEN_ID       the token the premiums are paid in
#   ADMIN_SOURCE           identity funding the pool, and the token issuer's
#                          admin otherwise
#   ISSUER_SOURCE          identity allowed to mint PREMIUM_TOKEN_ID
#   FARMER_SOURCE          identity that buys the policy and is paid out
#   ORACLE_SIGNER_SOURCES  two or more signer identities, space separated
# Optional:
#   STELLAR_NETWORK        a network the CLI knows, or a passphrase (default: testnet)
#   PREMIUM, PAYOUT        premium and payout in token units (default: 1000, 4000)
#   PREMIUM_ASSET          CODE:ISSUER of the classic asset PREMIUM_TOKEN_ID wraps.
#                          Given, the farmer gets a trustline for it first; omit it
#                          when the premium token needs no trustline (e.g. the
#                          native asset).
#   POOL_CAPITAL           capital the admin puts in the pool (default: 100000)
#
# Usage:
#   ./scripts/smoke-testnet.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

NETWORK="${STELLAR_NETWORK:-testnet}"
PREMIUM="${PREMIUM:-1000}"
# 4x the premium: under the registry's 5x cap, and comfortably inside the pool's
# solvency floor once the pool is capitalised below.
PAYOUT="${PAYOUT:-4000}"
POOL_CAPITAL="${POOL_CAPITAL:-100000}"
# The registry's minimum sellable window, so the policy is legal at the edge.
WEEK=604800

die() { echo "error: $*" >&2; exit 1; }

usage() {
  sed -n '2,38p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

for arg in "$@"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $arg (try --help)" ;;
  esac
done

command -v stellar >/dev/null 2>&1 \
  || die "the Stellar CLI ('stellar') is not on PATH: https://developers.stellar.org/docs/tools/cli"

for var in POLICY_REGISTRY_CONTRACT_ID PREMIUM_POOL_CONTRACT_ID PAYOUT_ENGINE_CONTRACT_ID \
           ORACLE_ADAPTER_CONTRACT_ID PREMIUM_TOKEN_ID ADMIN_SOURCE ISSUER_SOURCE \
           FARMER_SOURCE ORACLE_SIGNER_SOURCES; do
  [ -n "${!var:-}" ] || die "$var is required (try --help)"
done

for var in POLICY_REGISTRY_CONTRACT_ID PREMIUM_POOL_CONTRACT_ID PAYOUT_ENGINE_CONTRACT_ID \
           ORACLE_ADAPTER_CONTRACT_ID PREMIUM_TOKEN_ID; do
  printf '%s' "${!var}" | grep -Eq '^C[A-Z2-7]{55}$' \
    || die "$var is not a C... contract address: ${!var}"
done

# shellcheck disable=SC2206  # signer identities are deliberately split on whitespace
SIGNERS=($ORACLE_SIGNER_SOURCES)
[ "${#SIGNERS[@]}" -ge 2 ] || die "give at least two ORACLE_SIGNER_SOURCES"

invoke() { # $1 contract id, then the function and its named arguments
  local id="$1"
  shift
  stellar contract invoke --id "$id" --source "$ADMIN_SOURCE" --network "$NETWORK" -- "$@"
}

read_call() { # same, but a view: the value is the last line of stdout
  local id="$1"
  shift
  stellar contract invoke --id "$id" --source "$ADMIN_SOURCE" --network "$NETWORK" -- "$@" \
    2>/dev/null | tail -1 | tr -d '"'
}

# `create_policy` is signed by the farmer, not the admin: the registry checks the
# *farmer's* authorisation before it escrows anything.
farmer_invoke() {
  local id="$1"
  shift
  stellar contract invoke --id "$id" --source "$FARMER_SOURCE" --network "$NETWORK" -- "$@"
}

ADMIN_ADDRESS="$(stellar keys address "$ADMIN_SOURCE")"
FARMER_ADDRESS="$(stellar keys address "$FARMER_SOURCE")"

echo "==> exercising $POLICY_REGISTRY_CONTRACT_ID on $NETWORK"

# ---------------------------------------------------------------------------
# The farmer needs somewhere to receive the payout and something to pay with.
# A Stellar Asset Contract holds classic-asset balances, so the account needs a
# trustline before either can happen.
# ---------------------------------------------------------------------------
echo "==> trustline and premium for $FARMER_ADDRESS"
if [ -n "${PREMIUM_ASSET:-}" ]; then
  stellar tx new change-trust --line "$PREMIUM_ASSET" \
    --source "$FARMER_SOURCE" --network "$NETWORK" >/dev/null 2>&1 \
    || echo "    (trustline already present)"
fi

# The farmer pays the premium to the registry, which escrows it, so they need
# the tokens before they can buy cover.
stellar contract invoke --id "$PREMIUM_TOKEN_ID" --source "$ISSUER_SOURCE" --network "$NETWORK" \
  -- mint --to "$FARMER_ADDRESS" --amount "$PREMIUM" >/dev/null
# Capitalising the pool is a separate transfer, so the admin needs tokens too.
stellar contract invoke --id "$PREMIUM_TOKEN_ID" --source "$ISSUER_SOURCE" --network "$NETWORK" \
  -- mint --to "$ADMIN_ADDRESS" --amount "$POOL_CAPITAL" >/dev/null

# ---------------------------------------------------------------------------
# Timestamps. Publish the reading *after* cover opens: the trigger only counts
# readings inside the window, and a policy created for the present moment would
# leave no in-window instant that is already in the past.
# ---------------------------------------------------------------------------
now="$(date +%s)"
coverage_start=$((now + 120))
coverage_end=$((coverage_start + WEEK))
reading_ts=$((coverage_start + 5))
# A fresh plot per run. The registry rejects an *overlapping active* policy on a
# plot it already covers, and it cannot check dates without a timestamped run
# count, so a fixed plot hash would make the second run fail rather than measure
# anything new.
plot_hash="$(printf '%064x' "$now")"
# The trigger is "this much rain or less", well below the index the policy asks
# about, so the reading is unambiguously a breach.
trigger_threshold=300
reading_value=250

echo "==> creating a policy (cover opens at $coverage_start, closes at $coverage_end)"
policy_id="$(farmer_invoke "$POLICY_REGISTRY_CONTRACT_ID" create_policy \
  --farmer "$FARMER_ADDRESS" \
  --plot_hash "$plot_hash" \
  --crop_type maize \
  --region_id ng_kaduna \
  --coverage_start "$coverage_start" \
  --coverage_end "$coverage_end" \
  --trigger_threshold "$trigger_threshold" \
  --payout_amount "$PAYOUT" \
  --premium "$PREMIUM" 2>/dev/null | tail -1 | tr -d '"')"
[ -n "$policy_id" ] || die "create_policy produced no policy id"
echo "    policy id $policy_id"

echo "==> capitalising the pool with $POOL_CAPITAL"
pool_before="$(read_call "$PREMIUM_POOL_CONTRACT_ID" reserves)"
invoke "$PREMIUM_POOL_CONTRACT_ID" deposit --from "$ADMIN_ADDRESS" --amount "$POOL_CAPITAL" >/dev/null
echo "    pool reserves $pool_before -> $(read_call "$PREMIUM_POOL_CONTRACT_ID" reserves)"

echo "==> recognising the policy's payout as liability"
invoke "$PAYOUT_ENGINE_CONTRACT_ID" register_liability --policy_id "$policy_id" >/dev/null
echo "    liability registered: $(read_call "$PAYOUT_ENGINE_CONTRACT_ID" liability_registered --policy_id "$policy_id")"

# ---------------------------------------------------------------------------
# Two signers must independently agree on the same triple: one approval only
# opens a pending reading, and the threshold is what finalizes it.
# ---------------------------------------------------------------------------
echo "==> collecting signer approvals for ($reading_ts, $reading_value)"
for signer in "${SIGNERS[@]}"; do
  stellar contract invoke --id "$ORACLE_ADAPTER_CONTRACT_ID" --source "$signer" \
    --network "$NETWORK" -- submit_index \
    --signer "$(stellar keys address "$signer")" \
    --region_id ng_kaduna --index_value "$reading_value" --timestamp "$reading_ts" \
    >/dev/null
  echo "    $(stellar keys address "$signer") approved"
done

echo "==> the finalized reading"
read_call "$ORACLE_ADAPTER_CONTRACT_ID" get_latest_index --region_id ng_kaduna

echo "==> preview of the settlement"
invoke "$PAYOUT_ENGINE_CONTRACT_ID" evaluate --policy_id "$policy_id"

farmer_before="$(read_call "$PREMIUM_TOKEN_ID" balance --id "$FARMER_ADDRESS")"
echo "==> settling (farmer holds $farmer_before)"
invoke "$PAYOUT_ENGINE_CONTRACT_ID" settle_policy --policy_id "$policy_id"
farmer_after="$(read_call "$PREMIUM_TOKEN_ID" balance --id "$FARMER_ADDRESS")"

# The registry serialises the status as its discriminant, so it has to be named
# here rather than read back as one. `read_call` strips the quotes, so this
# matches the bare `status:1` rather than the JSON spelling.
policy_status="$(read_call "$POLICY_REGISTRY_CONTRACT_ID" get_policy --policy_id "$policy_id" \
  | grep -oE 'status:[0-9]+' | cut -d: -f2)"
case "$policy_status" in
  0) status_name=Active ;;
  1) status_name=Settled ;;
  2) status_name=Expired ;;
  3) status_name=Cancelled ;;
  *) status_name="unknown($policy_status)" ;;
esac

echo
echo "==> outcome"
cat <<EOF
policy id             $policy_id
farmer balance        $farmer_before -> $farmer_after
policy status         $status_name
pool reserves         $(read_call "$PREMIUM_POOL_CONTRACT_ID" reserves)
outstanding liability $(read_call "$PREMIUM_POOL_CONTRACT_ID" outstanding_liability)
EOF

# A clean exit means the whole path worked, not merely that every call returned.
if [ "$farmer_after" = "$farmer_before" ]; then
  die "the farmer was not paid: the settlement did not move the payout"
fi
[ "$policy_status" = 1 ] || die "the policy is $status_name, expected Settled"
echo "the farmer was paid $((farmer_after - farmer_before)) units and the policy is Settled"
