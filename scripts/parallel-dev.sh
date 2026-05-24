#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PARALLEL_DEV="${PARALLEL_DEV_SCRIPT:-${HOME}/.agents/skills/parallel-dev/scripts/parallel-dev.sh}"

usage() {
  cat <<'EOF'
Usage:
  scripts/parallel-dev.sh build
  scripts/parallel-dev.sh create <name> [base-branch]
  scripts/parallel-dev.sh tauri <name> [base-branch]
  scripts/parallel-dev.sh host-panel <name> [base-branch]
  scripts/parallel-dev.sh list
  scripts/parallel-dev.sh logs <name>
  scripts/parallel-dev.sh open <name>
  scripts/parallel-dev.sh destroy <name>

Default create profile:
  create      worktree + Docker Compose panel container
  tauri       worktree + host Tauri dev process
  host-panel  worktree + host Vite process
EOF
}

warn_if_parallel_files_uncommitted() {
  local changed
  changed="$(cd "$REPO_ROOT" && git status --short -- \
    .dockerignore \
    Dockerfile.dev \
    docker-compose.parallel.yml \
    parallel-dev.conf \
    pnpm-workspace.yaml \
    scripts/parallel-dev.sh)"

  if [ -n "$changed" ]; then
    cat >&2 <<'EOF'
Warning: parallel-dev files have uncommitted changes.
New worktrees are created from git, so commit these files or create from a branch that already contains them before expecting create to use the latest Docker setup.
EOF
  fi
}

run_parallel_dev() {
  if [ ! -x "$PARALLEL_DEV" ]; then
    echo "parallel-dev script not found or not executable: ${PARALLEL_DEV}" >&2
    exit 1
  fi

  (cd "$REPO_ROOT" && bash "$PARALLEL_DEV" "$@")
}

port_for_env() {
  local name="${1:?Missing environment name}"
  local env_file="${REPO_ROOT}/.claude/worktrees/${name}/.agent-env"

  if [ ! -f "$env_file" ]; then
    echo "Environment '${name}' not found at ${env_file}" >&2
    exit 1
  fi

  awk -F= '$1 == "PORT_APP" { print $2 }' "$env_file"
}

compose_logs() {
  local name="${1:?Missing environment name}"
  local compose_name="voicestream-${name}"
  local worktree_path="${REPO_ROOT}/.claude/worktrees/${name}"

  APP_SOURCE="$worktree_path" docker compose -p "$compose_name" \
    -f "$REPO_ROOT/docker-compose.parallel.yml" logs -f panel
}

case "${1:-}" in
  build)
    run_parallel_dev build
    ;;
  create)
    shift
    warn_if_parallel_files_uncommitted
    run_parallel_dev create "${1:?Missing environment name}" "${2:-HEAD}"
    ;;
  tauri)
    shift
    warn_if_parallel_files_uncommitted
    PARALLEL_PROFILE=tauri run_parallel_dev create "${1:?Missing environment name}" "${2:-HEAD}"
    ;;
  host-panel)
    shift
    warn_if_parallel_files_uncommitted
    PARALLEL_PROFILE=host-panel run_parallel_dev create "${1:?Missing environment name}" "${2:-HEAD}"
    ;;
  list)
    run_parallel_dev list
    ;;
  logs)
    shift
    compose_logs "${1:?Missing environment name}"
    ;;
  open)
    shift
    port="$(port_for_env "${1:?Missing environment name}")"
    echo "http://127.0.0.1:${port}/"
    ;;
  destroy)
    shift
    run_parallel_dev destroy "${1:?Missing environment name}"
    ;;
  ""|-h|--help|help)
    usage
    ;;
  *)
    echo "Unknown command: $1" >&2
    usage >&2
    exit 1
    ;;
esac
