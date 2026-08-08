#!/usr/bin/env bash
# Sourced by other scripts: loads .env and derives PRIVATE_KEY (+ ADDRESS)
# from MONAD_MNEMONIC (account #0) unless PRIVATE_KEY is already set.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi
if [[ -z "${PRIVATE_KEY:-}" && -n "${MONAD_MNEMONIC:-}" ]]; then
  PRIVATE_KEY="$(cast wallet private-key "$MONAD_MNEMONIC")"
  export PRIVATE_KEY
fi
if [[ -n "${PRIVATE_KEY:-}" ]]; then
  ADDRESS="$(cast wallet address "$PRIVATE_KEY")"
  export ADDRESS
fi
