<#
.SYNOPSIS
    AgriShield Local Standalone Devnet Setup & Seed Script (PowerShell)
.DESCRIPTION
    Automates the local standalone Soroban devnet setup: builds contracts,
    generates identities, deploys WASMs, wires mutual authorizations,
    seeds pool liquidity and oracle observations, and outputs .env files.
#>

param (
    [switch]$StartDocker
)

$ErrorActionPreference = "Stop"
Set-Location "$PSScriptRoot\.."

$RPC_URL = "http://localhost:8000/soroban/rpc"
$NETWORK_PASSPHRASE = "Standalone Network ; February 2017"
$NETWORK = "standalone"

Write-Host "==========================================================" -ForegroundColor Green
Write-Host "🌱 AgriShield Networks - Local Standalone Sandbox Setup" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green

$CLI = "stellar"
if (-not (Get-Command "stellar" -ErrorAction SilentlyContinue)) {
    if (Get-Command "soroban" -ErrorAction SilentlyContinue) {
        $CLI = "soroban"
    } else {
        Write-Error "Neither 'stellar' nor 'soroban' CLI found in PATH."
    }
}
Write-Host "✔ Using Stellar CLI: $CLI" -ForegroundColor Cyan

if ($StartDocker) {
    Write-Host "🐳 Launching local standalone Stellar container..." -ForegroundColor Yellow
    docker run -d --rm -p 8000:8000 --name agrishield-quickstart stellar/quickstart:latest --standalone --enable-soroban-rpc
    Start-Sleep -Seconds 10
}

Write-Host "⚙️ Configuring CLI network profile '$NETWORK'..." -ForegroundColor Cyan
& $CLI network add $NETWORK --rpc-url $RPC_URL --network-passphrase $NETWORK_PASSPHRASE 2>$null

Write-Host "🔑 Generating local identities..." -ForegroundColor Cyan
$identities = @("agrishield-admin", "agrishield-keeper", "agrishield-farmer", "agrishield-oracle-1", "agrishield-oracle-2")
foreach ($id in $identities) {
    & $CLI keys generate --network $NETWORK $id 2>$null
    & $CLI keys fund $id --network $NETWORK 2>$null
}

$ADMIN_ADDR = (& $CLI keys address agrishield-admin).Trim()
$KEEPER_ADDR = (& $CLI keys address agrishield-keeper).Trim()
$FARMER_ADDR = (& $CLI keys address agrishield-farmer).Trim()
$ORACLE_1 = (& $CLI keys address agrishield-oracle-1).Trim()
$ORACLE_2 = (& $CLI keys address agrishield-oracle-2).Trim()

Write-Host "  Admin:    $ADMIN_ADDR"
Write-Host "  Keeper:   $KEEPER_ADDR"
Write-Host "  Farmer:   $FARMER_ADDR"

Write-Host "🔨 Building release contracts..." -ForegroundColor Cyan
cargo +stable-x86_64-pc-windows-gnu build --target wasm32v1-none --release `
  --package agrishield-policy-registry `
  --package agrishield-premium-pool `
  --package agrishield-oracle-adapter `
  --package agrishield-payout-engine

$WASM_DIR = "target/wasm32v1-none/release"
Write-Host "🚀 Deploying contracts..." -ForegroundColor Cyan

$REGISTRY_ID = (& $CLI contract deploy --wasm "$WASM_DIR/agrishield_policy_registry.wasm" --source agrishield-admin --network $NETWORK).Trim()
$POOL_ID = (& $CLI contract deploy --wasm "$WASM_DIR/agrishield_premium_pool.wasm" --source agrishield-admin --network $NETWORK).Trim()
$ORACLE_ID = (& $CLI contract deploy --wasm "$WASM_DIR/agrishield_oracle_adapter.wasm" --source agrishield-admin --network $NETWORK).Trim()
$ENGINE_ID = (& $CLI contract deploy --wasm "$WASM_DIR/agrishield_payout_engine.wasm" --source agrishield-admin --network $NETWORK).Trim()

Write-Host "  Policy Registry: $REGISTRY_ID"
Write-Host "  Premium Pool:    $POOL_ID"
Write-Host "  Oracle Adapter:  $ORACLE_ID"
Write-Host "  Payout Engine:   $ENGINE_ID"

Write-Host "🔗 Initializing and wiring contracts..." -ForegroundColor Cyan
$TOKEN_ID = (& $CLI contract id asset --asset native --network $NETWORK).Trim()

& $CLI contract invoke --id $ORACLE_ID --source agrishield-admin --network $NETWORK -- initialize --admin $ADMIN_ADDR --threshold 2
& $CLI contract invoke --id $ORACLE_ID --source agrishield-admin --network $NETWORK -- add_signer --signer $ORACLE_1
& $CLI contract invoke --id $ORACLE_ID --source agrishield-admin --network $NETWORK -- add_signer --signer $ORACLE_2

& $CLI contract invoke --id $POOL_ID --source agrishield-admin --network $NETWORK -- initialize --admin $ADMIN_ADDR --token $TOKEN_ID --min_solvency_ratio_bps 12000
& $CLI contract invoke --id $REGISTRY_ID --source agrishield-admin --network $NETWORK -- initialize --admin $ADMIN_ADDR --premium_token $TOKEN_ID

& $CLI contract invoke --id $REGISTRY_ID --source agrishield-admin --network $NETWORK -- set_payout_engine --engine $ENGINE_ID
& $CLI contract invoke --id $POOL_ID --source agrishield-admin --network $NETWORK -- set_payout_engine --engine $ENGINE_ID

& $CLI contract invoke --id $ENGINE_ID --source agrishield-admin --network $NETWORK -- initialize --admin $ADMIN_ADDR --registry $REGISTRY_ID --pool $POOL_ID --oracle $ORACLE_ID

Write-Host "📝 Generating .env configurations..." -ForegroundColor Cyan
$KEEPER_KEY = (& $CLI keys show agrishield-keeper).Trim()

@"
SOROBAN_RPC_URL=$RPC_URL
SOROBAN_NETWORK=$NETWORK
SOROBAN_NETWORK_PASSPHRASE=$NETWORK_PASSPHRASE
POLICY_REGISTRY_CONTRACT_ID=$REGISTRY_ID
PAYOUT_ENGINE_CONTRACT_ID=$ENGINE_ID
PREMIUM_POOL_CONTRACT_ID=$POOL_ID
ORACLE_ADAPTER_CONTRACT_ID=$ORACLE_ID
SOROBAN_READ_SOURCE=$ADMIN_ADDR
KEEPER_SECRET_KEY=$KEEPER_KEY
KEEPER_ENABLED=true
KEEPER_INTERVAL_MS=15000
KEEPER_BATCH_SIZE=25
HOST=0.0.0.0
PORT=3000
LOG_LEVEL=debug
CORS_ORIGIN=*
"@ | Out-File -Encoding utf8 "backend/.env"

@"
VITE_API_BASE_URL=http://localhost:3000
"@ | Out-File -Encoding utf8 "frontend/.env"

Write-Host "==========================================================" -ForegroundColor Green
Write-Host "✅ AgriShield Local Sandbox Initialized & Ready!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
