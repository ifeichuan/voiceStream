#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DEFAULT_PROVIDER="aliyun-bailian"
DEFAULT_MODEL="qwen3.5-flash"

print_help() {
  cat <<'EOF'
VoiceStream dev helper

Usage:
  scripts/voicestream-dev.sh <command>

Commands:
  dev-fast           Start app in DictationFast mode with Bailian Qwen flash
  dev-voice          Start app in dictation-voice mode with Bailian Qwen flash
  dev-agent          Start app in agent mode with Bailian Qwen flash
  dev-fast-default   Start app in DictationFast mode without provider/model overrides
  bench [rounds]     Run repeated refine benchmark with Bailian Qwen flash
  bench-fresh [rounds]
                     Run repeated refine benchmark with Bailian Qwen flash using a fresh process each call
  bench-default [rounds]
                     Run repeated refine benchmark with default provider/model
  cargo-check        Run cargo check in src-tauri
  test-pi-rpc        Run Rust unit tests for pi_rpc
  list-models        Show pi models related to Bailian/Qwen
  env                Print the environment variables used by the helper
  help               Show this help

Environment overrides:
  VOICESTREAM_PI_PROVIDER        Default: aliyun-bailian
  VOICESTREAM_PI_MODEL           Default: qwen3.5-flash
  VOICESTREAM_PI_MODE            Used by dev commands when explicitly set
  VOICESTREAM_PI_BENCH_ROUNDS    Default bench rounds: 5
  VOICESTREAM_PI_STARTUP_TEST    Optional startup self-test toggle

Examples:
  scripts/voicestream-dev.sh dev-fast
  scripts/voicestream-dev.sh bench
  scripts/voicestream-dev.sh bench 10
  scripts/voicestream-dev.sh bench-fresh 10
  scripts/voicestream-dev.sh dev-agent
EOF
}

provider="${VOICESTREAM_PI_PROVIDER:-$DEFAULT_PROVIDER}"
model="${VOICESTREAM_PI_MODEL:-$DEFAULT_MODEL}"
bench_rounds_default="${VOICESTREAM_PI_BENCH_ROUNDS:-5}"

run_tauri_dev() {
  local mode="$1"
  VOICESTREAM_PI_PROVIDER="$provider" \
  VOICESTREAM_PI_MODEL="$model" \
  VOICESTREAM_PI_MODE="$mode" \
  ${VOICESTREAM_PI_STARTUP_TEST:+VOICESTREAM_PI_STARTUP_TEST="$VOICESTREAM_PI_STARTUP_TEST" } \
  pnpm tauri dev
}

command="${1:-help}"
rounds_arg="${2:-}"
bench_rounds="$bench_rounds_default"
if [[ -n "$rounds_arg" ]]; then
  if [[ "$rounds_arg" =~ ^[0-9]+$ ]] && [[ "$rounds_arg" != "0" ]]; then
    bench_rounds="$rounds_arg"
  else
    echo "Invalid rounds value: $rounds_arg" >&2
    exit 1
  fi
fi

case "$command" in
  dev-fast)
    run_tauri_dev "dictation-fast"
    ;;
  dev-voice)
    run_tauri_dev "dictation-voice"
    ;;
  dev-agent)
    run_tauri_dev "agent"
    ;;
  dev-fast-default)
    VOICESTREAM_PI_MODE="dictation-fast" pnpm tauri dev
    ;;
  bench)
    cd src-tauri
    VOICESTREAM_PI_PROVIDER="$provider" \
    VOICESTREAM_PI_MODEL="$model" \
    VOICESTREAM_PI_MODE="dictation-fast" \
    VOICESTREAM_PI_REUSE_PROCESS=1 \
    VOICESTREAM_PI_BENCH_ROUNDS="$bench_rounds" \
    cargo test pi_rpc_repeated_refine_same_text -- --ignored --nocapture
    ;;
  bench-fresh)
    cd src-tauri
    VOICESTREAM_PI_PROVIDER="$provider" \
    VOICESTREAM_PI_MODEL="$model" \
    VOICESTREAM_PI_MODE="dictation-fast" \
    VOICESTREAM_PI_REUSE_PROCESS=0 \
    VOICESTREAM_PI_BENCH_ROUNDS="$bench_rounds" \
    cargo test pi_rpc_repeated_refine_same_text -- --ignored --nocapture
    ;;
  bench-default)
    cd src-tauri
    VOICESTREAM_PI_MODE="dictation-fast" \
    VOICESTREAM_PI_BENCH_ROUNDS="$bench_rounds" \
    cargo test pi_rpc_repeated_refine_same_text -- --ignored --nocapture
    ;;
  cargo-check)
    cd src-tauri
    cargo check
    ;;
  test-pi-rpc)
    cd src-tauri
    cargo test pi_rpc -- --nocapture
    ;;
  list-models)
    pi --list-models bailian || true
    echo
    pi --list-models qwen || true
    ;;
  env)
    cat <<EOF
ROOT_DIR=$ROOT_DIR
VOICESTREAM_PI_PROVIDER=$provider
VOICESTREAM_PI_MODEL=$model
VOICESTREAM_PI_BENCH_ROUNDS_DEFAULT=$bench_rounds_default
VOICESTREAM_PI_MODE=${VOICESTREAM_PI_MODE:-<unset>}
VOICESTREAM_PI_STARTUP_TEST=${VOICESTREAM_PI_STARTUP_TEST:-<unset>}
EOF
    ;;
  help|--help|-h)
    print_help
    ;;
  *)
    echo "Unknown command: $command" >&2
    echo >&2
    print_help
    exit 1
    ;;
esac
