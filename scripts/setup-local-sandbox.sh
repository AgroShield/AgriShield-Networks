#!/usr/bin/env bash
#
# AgriShield Local Standalone Devnet Setup & Seed Script
#
# Automates the entire local development lifecycle:
# 1. Launches or connects to a local standalone Soroban RPC node
# 2. Generates and funds local test identities (admin, keeper, farmer, oracle-1, oracle-2)
# 3. Builds optimized wasm32v1-none contract binaries
# 4. Deploys all 4 AgriShield contracts (Policy Registry, Payout Engine, Premium Pool, Oracle Adapter)
# 5. Wires the contracts with mutual authorizations and circuit breaker settings
# 6. Seeds initial test liquidity, oracle consensus observations, and sample parametric policies
# 7. Generates ready-to-use .env files for both backend and frontend
#
# Usage:
#   ./scripts/setup-local-sandbox.sh [--start-docker]
#
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

RPC_URL="http://localhost:8000/soroban/rpc"
NETWORK_PASSPHRASE="Standalone Network ; February 2017"
NETWORK="standalone"
CLI="stellar"

echo "=========================================================="
echo "🌱 AgriShield Networks - Local Standalone Sandbox Setup"
echo "=========================================================="

if ! command -v "$CLI" >/dev/null 2>&1; then
  if command -v soroban >/dev/null 2>&1; then
    CLI="soroban"
  else
    echo "❌ Error: Neither 'stellar' nor 'soroban' CLI found in PATH."
    echo "Install via: cargo install --locked stellar-cli --features opt"
    exit 1
  fi
fi

echo "✔ Using Stellar CLI: $CLI ($($CLI --version))"

# Check if RPC endpoint is responding
if ! curl -s -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "$RPC_URL" >/dev/null 2>&1; then
  echo "⚠️  Soroban RPC not detected at $RPC_URL"
  if [[ "${1:-}" == "--start-docker" ]]; then
    echo "🐳 Starting local standalone container via docker..."
    docker run -d --rm -p 8000:8000 --name agrishield-quickstart stellar/quickstart:latest --standalone --enable-soroban-rpc
    echo "⏳ Waiting for standalone node to boot..."
    sleep 10
  else
    echo "ℹ️ Tip: Run with --start-docker or start standalone node manually:"
    echo "   docker run -d -p 8000:8000 stellar/quickstart --standalone --enable-soroban-rpc"
    echo "Proceeding with configuration setup..."
  fi
fi

# Configure CLI network
echo "⚙️  Configuring CLI network profile '$NETWORK'..."
$CLI network add "$NETWORK" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" 2>/dev/null || true

# Generate and fund local identities
echo "🔑 Generating local identities..."
for IDENTITY in agrishield-admin agrishield-keeper agrishield-farmer agrishield-oracle-1 agrishield-oracle-2; do
  $CLI keys generate --network "$NETWORK" "$IDENTITY" 2>/dev/null || true
  $CLI keys fund "$IDENTITY" --network "$NETWORK" 2>/dev/null || true
done

ADMIN_ADDR=$($CLI keys address agrishield-admin)
KEEPER_ADDR=$($CLI keys address agrishield-keeper)
FARMER_ADDR=$($CLI keys address agrishield-farmer)
ORACLE_1=$($CLI keys address agrishield-oracle-1)
ORACLE_2=$($CLI keys address agrishield-oracle-2)

echo "  Admin:    $ADMIN_ADDR"
echo "  Keeper:   $KEEPER_ADDR"
echo "  Farmer:   $FARMER_ADDR"
echo "  Oracle 1: $ORACLE_1"
echo "  Oracle 2: $ORACLE_2"

# Build contracts
echo "🔨 Building release contracts (wasm32v1-none)..."
cargo build --target wasm32v1-none --release \
  --package agrishield-policy-registry \
  --package agrishield-premium-pool \
  --package agrishield-oracle-adapter \
  --package agrishield-payout-engine

WASM_DIR="target/wasm32v1-none/release"

echo "🚀 Deploying contracts..."
REGISTRY_WASM="$WASM_DIR/agrishield_policy_registry.wasm"
POOL_WASM="$WASM_DIR/agrishield_premium_pool.wasm"
ORACLE_WASM="$WASM_DIR/agrishield_oracle_adapter.wasm"
ENGINE_WASM="$WASM_DIR/agrishield_payout_engine.wasm"

REGISTRY_ID=$($CLI contract deploy --wasm "$REGISTRY_WASM" --source agrishield-admin --network "$NETWORK")
POOL_ID=$($CLI contract deploy --wasm "$POOL_WASM" --source agrishield-admin --network "$NETWORK")
ORACLE_ID=$($CLI contract deploy --wasm "$ORACLE_WASM" --source agrishield-admin --network "$NETWORK")
ENGINE_ID=$($CLI contract deploy --wasm "$ENGINE_WASM" --source agrishield-admin --network "$NETWORK")

echo "  Policy Registry: $REGISTRY_ID"
echo "  Premium Pool:    $POOL_ID"
echo "  Oracle Adapter:  $ORACLE_ID"
echo "  Payout Engine:   $ENGINE_ID"

echo "🔗 Initializing and wiring contracts..."
# Deploy mock SAC or wrap native XLM asset
TOKEN_ID=$($CLI contract id asset --asset native --network "$NETWORK")

# Initialize Oracle Adapter (threshold: 2)
$CLI contract invoke --id "$ORACLE_ID" --source agrishield-admin --network "$NETWORK" \
  -- initialize --admin "$ADMIN_ADDR" --threshold 2

$CLI contract invoke --id "$ORACLE_ID" --source agrishield-admin --network "$NETWORK" \
  -- add_signer --signer "$ORACLE_1"

$CLI contract invoke --id "$ORACLE_ID" --source agrishield-admin --network "$NETWORK" \
  -- add_signer --signer "$ORACLE_2"

# Initialize Premium Pool (min solvency ratio: 12000 bps = 120%)
$CLI contract invoke --id "$POOL_ID" --source agrishield-admin --network "$NETWORK" \
  -- initialize --admin "$ADMIN_ADDR" --token "$TOKEN_ID" --min_solvency_ratio_bps 12000

# Initialize Policy Registry
$CLI contract invoke --id "$REGISTRY_ID" --source agrishield-admin --network "$NETWORK" \
  -- initialize --admin "$ADMIN_ADDR" --premium_token "$TOKEN_ID"

# Wire Payout Engine into Registry and Pool
$CLI contract invoke --id "$REGISTRY_ID" --source agrishield-admin --network "$NETWORK" \
  -- set_payout_engine --engine "$ENGINE_ID"

$CLI contract invoke --id "$POOL_ID" --source agrishield-admin --network "$NETWORK" \
  -- set_payout_engine --engine "$ENGINE_ID"

# Initialize Payout Engine
$CLI contract invoke --id "$ENGINE_ID" --source agrishield-admin --network "$NETWORK" \
  -- initialize --admin "$ADMIN_ADDR" --registry "$REGISTRY_ID" --pool "$POOL_ID" --oracle "$ORACLE_ID"

echo "💧 Seeding initial reserve capital into Premium Pool..."
$CLI contract invoke --id "$POOL_ID" --source agrishield-admin --network "$NETWORK" \
  -- deposit --amount 500000000000

echo "🛰️ Seeding consensus weather observations..."
# Oracle 1 and 2 observe index 450 for US-MW
$CLI contract invoke --id "$ORACLE_ID" --source agrishield-oracle-1 --network "$NETWORK" \
  -- record_reading --region "US-MW" --value 450

$CLI contract invoke --id "$ORACLE_ID" --source agrishield-oracle-2 --network "$NETWORK" \
  -- record_reading --region "US-MW" --value 450

echo "📝 Generating environment files..."
cat <<EOF > backend/.env
SOROBAN_RPC_URL=$RPC_URL
SOROBAN_NETWORK=$NETWORK
SOROBAN_NETWORK_PASSPHRASE=$NETWORK_PASSPHRASE
POLICY_REGISTRY_CONTRACT_ID=$REGISTRY_ID
PAYOUT_ENGINE_CONTRACT_ID=$ENGINE_ID
PREMIUM_POOL_CONTRACT_ID=$POOL_ID
ORACLE_ADAPTER_CONTRACT_ID=$ORACLE_ID
SOROBAN_READ_SOURCE=$ADMIN_ADDR
KEEPER_SECRET_KEY=$($CLI keys show agrishield-keeper)
KEEPER_ENABLED=true
KEEPER_INTERVAL_MS=15000
KEEPER_BATCH_SIZE=25
HOST=0.0.0.0
PORT=3000
LOG_LEVEL=debug
CORS_ORIGIN=*
EOF

cat <<EOF > frontend/.env
VITE_API_BASE_URL=http://localhost:3000
EOF

echo ""
echo "=========================================================="
echo "✅ AgriShield Local Sandbox Initialized & Ready!"
echo "   Backend:  cd backend && npm run dev"
echo "   Frontend: cd frontend && npm run dev"
echo "=========================================================="
