#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

FORCE_DEPLOY="false"

usage() {
  cat <<'EOF'
Usage: auto-deploy.sh [OPTIONS]

Fetches remote Git changes and deploys only when new commits exist (unless --force is passed).

Options:
  --force         Run build & deploy even if HEAD matches upstream
  -h, --help      Show this help message

Environment Variables:
  REPO_DIR        Git repository path (default: parent directory of scripts/)
  GIT_REMOTE      Git remote name (default: origin)
  GIT_BRANCH      Target branch (default: current branch, fallback: main)
  DEPLOY_MODE     auto | docker | systemd | custom (default: auto)
  APP_SERVICE     Systemd service name to restart in systemd mode (default: gpx-route-master.service)
  DEPLOY_CMD      Custom shell command run when DEPLOY_MODE=custom
  RUN_TESTS       true | false (default: false) -> runs 'npm run lint && npm test' before deploy
  LOCK_FILE       Lock path to prevent concurrent runs (default: /tmp/gpx-route-master-autodeploy.lock)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)
      FORCE_DEPLOY="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

log() {
  printf '[%s] [auto-deploy] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

die() {
  printf '[%s] [auto-deploy] ERROR: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >&2
  exit 1
}

REPO_DIR="${REPO_DIR:-$DEFAULT_REPO_DIR}"
GIT_REMOTE="${GIT_REMOTE:-origin}"
DEPLOY_MODE="${DEPLOY_MODE:-auto}"
APP_SERVICE="${APP_SERVICE:-gpx-route-master.service}"
DEPLOY_CMD="${DEPLOY_CMD:-}"
RUN_TESTS="${RUN_TESTS:-false}"
LOCK_FILE="${LOCK_FILE:-/tmp/gpx-route-master-autodeploy.lock}"

[[ -d "$REPO_DIR" ]] || die "Repository directory not found: $REPO_DIR"
[[ -d "${REPO_DIR}/.git" ]] || die "Not a git repository: $REPO_DIR"
command -v git >/dev/null 2>&1 || die "git is required"

case "$DEPLOY_MODE" in
  auto|docker|systemd|custom) ;;
  *) die "Invalid DEPLOY_MODE '$DEPLOY_MODE'. Expected: auto | docker | systemd | custom" ;;
esac

# Acquire exclusive lock so overlapping timers/manual runs never collide
LOCK_DIR="${LOCK_FILE}.d"
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    log "Another auto-deploy instance is already running. Exiting cleanly."
    exit 0
  fi
else
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    log "Another auto-deploy instance is already running (${LOCK_DIR}). Exiting cleanly."
    exit 0
  fi
  trap 'rmdir "$LOCK_DIR" >/dev/null 2>&1 || true' EXIT
fi

cd "$REPO_DIR"

if [[ -z "${GIT_BRANCH:-}" ]]; then
  GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  if [[ -z "$GIT_BRANCH" || "$GIT_BRANCH" == "HEAD" ]]; then
    GIT_BRANCH="main"
  fi
fi

# Abort cleanly if tracked files have local modifications so automated pulls never clobber edits
DIRTY_TRACKED="$(git status --porcelain --untracked-files=no)"
if [[ -n "$DIRTY_TRACKED" ]]; then
  die "Tracked files have uncommitted changes in $REPO_DIR. Resolve before automated deploy:"$'\n'"$DIRTY_TRACKED"
fi

log "Checking ${GIT_REMOTE}/${GIT_BRANCH} in ${REPO_DIR}..."
git fetch --prune "$GIT_REMOTE" "$GIT_BRANCH"

LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse "${GIT_REMOTE}/${GIT_BRANCH}")"

if [[ "$LOCAL_SHA" == "$REMOTE_SHA" ]]; then
  if [[ "$FORCE_DEPLOY" != "true" ]]; then
    log "No changes detected on ${GIT_REMOTE}/${GIT_BRANCH} (${LOCAL_SHA:0:7}). Skipping deploy."
    exit 0
  fi
  log "No remote changes (${LOCAL_SHA:0:7}), continuing due to --force."
else
  log "New commits detected: ${LOCAL_SHA:0:7} -> ${REMOTE_SHA:0:7}"
  git log --oneline "${LOCAL_SHA}..${REMOTE_SHA}" || true
  git pull --ff-only "$GIT_REMOTE" "$GIT_BRANCH"
  log "Pulled updates to $(git rev-parse --short HEAD)."
fi

if [[ "$RUN_TESTS" == "true" ]]; then
  command -v npm >/dev/null 2>&1 || die "npm is required when RUN_TESTS=true"
  log "Running pre-deploy typecheck & test suite..."
  npm run lint
  npm test
fi

deploy_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "Deploying with 'docker compose up -d --build --remove-orphans'..."
    docker compose up -d --build --remove-orphans
  elif command -v docker-compose >/dev/null 2>&1; then
    log "Deploying with 'docker-compose up -d --build --remove-orphans'..."
    docker-compose up -d --build --remove-orphans
  else
    die "Docker Compose is not installed."
  fi
}

deploy_systemd_node() {
  command -v npm >/dev/null 2>&1 || die "npm is required for native Node build"
  log "Installing dependencies & building production bundle..."
  npm install --no-fund
  npm run build

  if command -v systemctl >/dev/null 2>&1; then
    if systemctl list-unit-files "$APP_SERVICE" >/dev/null 2>&1 && systemctl list-unit-files "$APP_SERVICE" | grep -q "$APP_SERVICE"; then
      log "Restarting systemd unit: ${APP_SERVICE}..."
      systemctl restart "$APP_SERVICE"
    else
      log "Note: App unit '${APP_SERVICE}' not found in systemd; skipped service restart."
    fi
  else
    log "Note: systemctl not available; build updated in dist/ without service restart."
  fi
}

case "$DEPLOY_MODE" in
  docker)
    deploy_docker
    ;;
  systemd)
    deploy_systemd_node
    ;;
  custom)
    [[ -n "$DEPLOY_CMD" ]] || die "DEPLOY_MODE=custom requires DEPLOY_CMD to be set."
    log "Running custom deploy command..."
    bash -lc "$DEPLOY_CMD"
    ;;
  auto)
    if [[ -f "${REPO_DIR}/docker-compose.yml" ]] && command -v docker >/dev/null 2>&1 && (docker compose version >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1); then
      deploy_docker
    else
      deploy_systemd_node
    fi
    ;;
esac

log "Deploy completed successfully at commit $(git rev-parse --short HEAD)."
