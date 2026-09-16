#!/usr/bin/env bash
#
# Guards the `[profile.release]` table in the root Cargo.toml.
#
# Every value in that table is a rustc codegen option, and rustc only reads it
# while compiling the first crate in the release profile. That makes a bad value
# invisible to everything else in this repository:
#
#   * `cargo metadata` exits zero — it never validates profile values;
#   * `cargo build` and every test run use the default profile and never open
#     the table;
#   * so the failure waits for `cargo build --release`, the one command a
#     deployment runs and nothing else does.
#
# `strip = "symbol"` — rustc wants `symbols` — is the value that shipped here and
# waited exactly that way. This script builds the profile the contracts are
# deployed with, for the target they are deployed to, so a typo fails on push
# instead of on deploy.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

TARGET="wasm32-unknown-unknown"
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

if ! command -v cargo >/dev/null 2>&1; then
  echo "error: cargo is not on PATH" >&2
  exit 1
fi

if ! rustup target list --installed 2>/dev/null | grep -qx "$TARGET"; then
  echo "error: the $TARGET target is not installed; run: rustup target add $TARGET" >&2
  exit 1
fi

echo "==> building the release profile for $TARGET"
if cargo build --release --target "$TARGET" --workspace >"$LOG" 2>&1; then
  cat "$LOG"
  echo "==> release profile accepted; every contract built for $TARGET"
  exit 0
fi

cat "$LOG" >&2

if grep -q "codegen option" "$LOG"; then
  cat >&2 <<'EOF'

==> a value in [profile.release] is one rustc does not accept. This is not a
    problem in the contract code, and nothing else in this repository will show
    it to you: cargo reads the manifest without complaint and every debug build
    and test run skips the table entirely.
EOF
fi

exit 1
