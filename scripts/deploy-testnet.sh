#!/usr/bin/env bash
#
# Deploys the four AgriShield contracts to a Stellar network and wires them to
# each other.
#
# Wiring is not optional, and its order is forced. The registry and the pool each
# refuse to pay out unless the caller is the engine address they were told about,
# so neither can be pointed anywhere until the engine exists; the engine's own
# `initialize` then needs all three of the others. That gives:
#
#   registry   deploy -> initialize(admin, premium_token)
#                      -> set_payout_engine(engine)
#   pool       deploy -> initialize(admin, token, min_solvency_ratio_bps)
#                      -> set_payout_engine(engine)
#   oracle     deploy -> initialize(admin, threshold)
#                      -> add_signer(signer) once per signer
#   engine     deploy -> initialize(admin, registry, pool, oracle)
#
# The engine is deployed before it is registered, and initialized last.
#
# Nothing here is idempotent: each run deploys a fresh set of contracts. The
# addresses are printed at the end, and written to $ENV_OUT when that is set.
#
# Required environment:
#   STELLAR_SOURCE         identity name or secret key that is the admin, and
#                          therefore holds the admin's funds and authority
#   ADMIN_ADDRESS          the admin's public key (G...); must belong to the source
#   PREMIUM_TOKEN_ID       the token the registry escrows and the pool custodies,
#                          e.g. a Stellar Asset Contract (C...)
#   ORACLE_THRESHOLD       distinct signers a reading needs to finalize (1..15)
#   ORACLE_SIGNERS         the authorised signers, space separated (max 15)
# Optional:
#   MIN_SOLVENCY_RATIO_BPS floor the pool enforces on admin withdrawals,
#                          1..1000000 basis points (default: 12000)
#   STELLAR_NETWORK        a network the CLI knows, or a passphrase (default: testnet)
#   ENV_OUT                file to write the contract addresses to
#
# Usage:
#   ./scripts/deploy-testnet.sh [--dry-run]
#
# --dry-run prints every command it would run and deploys nothing.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

TARGET="wasm32-unknown-unknown"
RELEASE_DIR="target/$TARGET/release"
NETWORK="${STELLAR_NETWORK:-testnet}"
RATIO="${MIN_SOLVENCY_RATIO_BPS:-12000}"
DRY_RUN=0

# Mirrors MAX_SIGNERS in contracts/oracle-adapter/src/types.rs.
MAX_SIGNERS=15
# Mirrors MAX_SOLVENCY_RATIO_BPS in contracts/premium-pool/src/types.rs.
MAX_RATIO_BPS=1000000

die() { echo "error: $*" >&2; exit 1; }

usage() {
  sed -n '2,48p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $arg (try --help)" ;;
  esac
done

# ---------------------------------------------------------------------------
# Preflight: fail before deploying anything, not half way through.
# ---------------------------------------------------------------------------
if [ "$DRY_RUN" = 0 ]; then
  command -v stellar >/dev/null 2>&1 \
    || die "the Stellar CLI ('stellar') is not on PATH: https://developers.stellar.org/docs/tools/cli"
fi

for var in STELLAR_SOURCE ADMIN_ADDRESS PREMIUM_TOKEN_ID ORACLE_THRESHOLD ORACLE_SIGNERS; do
  [ -n "${!var:-}" ] || die "$var is required (try --help)"
done

is_strkey() { # $1 value, $2 expected prefix
  printf '%s' "$1" | grep -Eq "^$2[A-Z2-7]{55}$"
}
is_strkey "$ADMIN_ADDRESS" G || die "ADMIN_ADDRESS is not a G... account address"
is_strkey "$PREMIUM_TOKEN_ID" C || die "PREMIUM_TOKEN_ID is not a C... contract address"

case "$ORACLE_THRESHOLD" in
  ''|*[!0-9]*) die "ORACLE_THRESHOLD must be a whole number, got '$ORACLE_THRESHOLD'" ;;
esac

# shellcheck disable=SC2206  # signers are deliberately split on whitespace
SIGNERS=($ORACLE_SIGNERS)
[ "${#SIGNERS[@]}" -gt 0 ] || die "ORACLE_SIGNERS is empty"

# A threshold above the signer count is unsatisfiable: no reading could ever
# finalize, and the oracle would accept every submission and settle nothing.
[ "$ORACLE_THRESHOLD" -ge 1 ] || die "ORACLE_THRESHOLD must be at least 1"
[ "$ORACLE_THRESHOLD" -le "${#SIGNERS[@]}" ] \
  || die "ORACLE_THRESHOLD ($ORACLE_THRESHOLD) exceeds the ${#SIGNERS[@]} signer(s) given; no reading could ever finalize"
[ "${#SIGNERS[@]}" -le "$MAX_SIGNERS" ] \
  || die "${#SIGNERS[@]} signers given; the oracle caps the set at $MAX_SIGNERS"

for s in "${SIGNERS[@]}"; do
  is_strkey "$s" G || die "ORACLE_SIGNERS contains a non-account value: $s"
done

case "$RATIO" in
  ''|*[!0-9-]*) die "MIN_SOLVENCY_RATIO_BPS must be a whole number, got '$RATIO'" ;;
esac
[ "$RATIO" -ge 1 ] && [ "$RATIO" -le "$MAX_RATIO_BPS" ] \
  || die "MIN_SOLVENCY_RATIO_BPS must be within 1..$MAX_RATIO_BPS, got $RATIO"

# ---------------------------------------------------------------------------
# Build the artifacts being deployed, so the run is reproducible and the
# release profile is exercised before anything reaches a network.
# ---------------------------------------------------------------------------
if [ "$DRY_RUN" = 0 ]; then
  echo "==> building $TARGET release artifacts"
  cargo build --release --target "$TARGET" --workspace
fi

wasm_for() { # $1 crate name -> artifact path (cargo underscores the file name)
  printf '%s/%s.wasm' "$RELEASE_DIR" "$(printf '%s' "$1" | tr '-' '_')"
}

for crate in policy-registry oracle-adapter payout-engine premium-pool; do
  if [ "$DRY_RUN" = 0 ]; then
    [ -f "$(wasm_for "$crate")" ] || die "missing artifact: $(wasm_for "$crate")"
  fi
done

run() {
  if [ "$DRY_RUN" = 1 ]; then
    printf '  %s\n' "$*"
    return 0
  fi
  "$@"
}

deploy_contract() { # $1 crate name, $2 label used in dry-run output
  local wasm out id
  wasm="$(wasm_for "$1")"
  if [ "$DRY_RUN" = 1 ]; then
    # The plan goes to stderr: stdout is captured by the caller as the id.
    printf '  stellar contract deploy --wasm %s --source *** --network %s  -> <%s-id>\n' \
      "$wasm" "$NETWORK" "$2" >&2
    printf '<%s-id>\n' "$2"
    return 0
  fi
  out="$(stellar contract deploy --wasm "$wasm" --source "$STELLAR_SOURCE" --network "$NETWORK")"
  # The CLI writes progress to stderr and the new contract id to stdout; take the
  # last C... strkey so a banner or a warning line cannot be mistaken for it.
  id="$(printf '%s\n' "$out" | grep -Eo 'C[A-Z0-9]{55}' | tail -1)"
  [ -n "$id" ] || die "could not read a contract id out of the deploy output for $1: $out"
  printf '%s\n' "$id"
}

invoke() { # $1 contract id, rest: function and named arguments
  local id="$1"
  shift
  run stellar contract invoke --id "$id" --source "$STELLAR_SOURCE" --network "$NETWORK" -- "$@"
}

echo "==> deploying to $NETWORK as $ADMIN_ADDRESS"

REGISTRY_ID="$(deploy_contract policy-registry registry)"
POOL_ID="$(deploy_contract premium-pool pool)"
ORACLE_ID="$(deploy_contract oracle-adapter oracle)"
ENGINE_ID="$(deploy_contract payout-engine engine)"

echo "==> wiring"
# The engine is named in both places that move money, and each verifies the
# caller itself, so a policy cannot be settled twice or paid by a stranger.
invoke "$REGISTRY_ID" initialize --admin "$ADMIN_ADDRESS" --premium_token "$PREMIUM_TOKEN_ID"
invoke "$POOL_ID" initialize --admin "$ADMIN_ADDRESS" --token "$PREMIUM_TOKEN_ID" \
  --min_solvency_ratio_bps "$RATIO"
invoke "$ORACLE_ID" initialize --admin "$ADMIN_ADDRESS" --threshold "$ORACLE_THRESHOLD"
for s in "${SIGNERS[@]}"; do
  invoke "$ORACLE_ID" add_signer --admin "$ADMIN_ADDRESS" --signer "$s"
done

invoke "$REGISTRY_ID" set_payout_engine --admin "$ADMIN_ADDRESS" --payout_engine "$ENGINE_ID"
invoke "$POOL_ID" set_payout_engine --admin "$ADMIN_ADDRESS" --payout_engine "$ENGINE_ID"
invoke "$ENGINE_ID" initialize --admin "$ADMIN_ADDRESS" \
  --policy_registry "$REGISTRY_ID" --premium_pool "$POOL_ID" --oracle "$ORACLE_ID"

# ---------------------------------------------------------------------------
# Read back what the oracle recorded. A mismatch here means the addresses above
# are not safe to point the backend at, so say so loudly; the deploy itself has
# already happened either way.
# ---------------------------------------------------------------------------
if [ "$DRY_RUN" = 0 ]; then
  echo "==> verifying the oracle"
  got_threshold="$(stellar contract invoke --id "$ORACLE_ID" --source "$STELLAR_SOURCE" \
    --network "$NETWORK" -- get_threshold 2>/dev/null | grep -Eo '[0-9]+' | tail -1 || true)"
  got_signers="$(stellar contract invoke --id "$ORACLE_ID" --source "$STELLAR_SOURCE" \
    --network "$NETWORK" -- get_signers 2>/dev/null | grep -Eo 'G[A-Z2-7]{55}' | sort -u | wc -l || true)"

  if [ "$got_threshold" = "$ORACLE_THRESHOLD" ] && [ "$got_signers" = "${#SIGNERS[@]}" ]; then
    echo "    threshold $got_threshold, $got_signers signer(s)"
  else
    echo "    WARNING: the oracle reports threshold='${got_threshold:-?}' and" >&2
    echo "    '${got_signers:-?}' signer(s), expected '$ORACLE_THRESHOLD' and '${#SIGNERS[@]}'." >&2
    echo "    Check it with: stellar contract invoke --id $ORACLE_ID -- get_threshold" >&2
  fi
fi

echo
echo "==> deployed"
cat <<EOF
POLICY_REGISTRY_CONTRACT_ID=$REGISTRY_ID
PAYOUT_ENGINE_CONTRACT_ID=$ENGINE_ID
PREMIUM_POOL_CONTRACT_ID=$POOL_ID
ORACLE_ADAPTER_CONTRACT_ID=$ORACLE_ID
EOF

if [ -n "${ENV_OUT:-}" ]; then
  if [ "$DRY_RUN" = 1 ]; then
    echo "would write the above to $ENV_OUT"
  else
    cat >>"$ENV_OUT" <<EOF

# Deployed by scripts/deploy-testnet.sh to $NETWORK
POLICY_REGISTRY_CONTRACT_ID=$REGISTRY_ID
PAYOUT_ENGINE_CONTRACT_ID=$ENGINE_ID
PREMIUM_POOL_CONTRACT_ID=$POOL_ID
ORACLE_ADAPTER_CONTRACT_ID=$ORACLE_ID
EOF
    echo "wrote them to $ENV_OUT"
  fi
fi
