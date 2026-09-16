#!/usr/bin/env bash
#
# Rebuilds the deployed wasm in a second target directory and compares the
# hashes against the first build.
#
# A Rust build is a function of its inputs — the toolchain, the release profile
# and the sources — so the same inputs should produce the same bytes wherever
# the build ran. That is what makes a deployed contract checkable: anyone can
# rebuild it and compare. The comparison is only worth anything if the rebuild
# does not quietly depend on the machine, so this asserts it rather than
# assuming it, and a failure here means an artifact can no longer be traced back
# to the source it claims to be.
#
# Nothing about the profile is accidental here: `strip = "symbols"` and
# `debug = 0` keep the target directory's path out of the binary, which is the
# usual reason two builds of identical sources differ.
#
# The first build reuses the default target directory, so running this after
# `check-release-profile.sh` costs one extra build rather than two.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

TARGET="wasm32-unknown-unknown"
SECOND="target/reproducible"

# The workspace manifest is the source of truth for what gets deployed.
members="$(sed -n '/^members = \[/,/^\]/p' Cargo.toml | grep -oE '"[^"]+"' | tr -d '"')"
if [ -z "$members" ]; then
  echo "error: could not read workspace members from Cargo.toml" >&2
  exit 1
fi

echo "==> first build (default target directory)"
cargo build --release --target "$TARGET" --workspace

echo "==> second build ($SECOND)"
rm -rf "$SECOND"
CARGO_TARGET_DIR="$PWD/$SECOND" cargo build --release --target "$TARGET" --workspace >/dev/null

failed=0
for member in $members; do
  crate="$(basename "$member")"
  # cargo writes the artifact with the crate's hyphens as underscores.
  artefact="$(printf '%s' "$crate" | tr '-' '_').wasm"
  first="target/$TARGET/release/$artefact"
  second="$SECOND/$TARGET/release/$artefact"

  for path in "$first" "$second"; do
    if [ ! -f "$path" ]; then
      echo "error: expected an artefact at $path" >&2
      exit 1
    fi
  done

  h1="$(sha256sum "$first" | cut -d' ' -f1)"
  h2="$(sha256sum "$second" | cut -d' ' -f1)"
  if [ "$h1" = "$h2" ]; then
    printf '  %-16s %s…\n' "$crate" "${h1:0:16}"
  else
    printf '  %-16s %s…\n  %-16s %s…\n' "$crate" "${h1:0:16}" " " "${h2:0:16}"
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  cat >&2 <<'EOF'

==> the two builds disagree, so a deployed artefact cannot be checked against
    the source it claims to be. Something in the build is not a function of the
    sources alone: an absolute path reaching the binary, a timestamp, or a
    dependency that resolved differently between the two runs.
EOF
  exit 1
fi

echo "==> both builds agree; the artefacts are reproducible"
