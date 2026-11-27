#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

FORCE_DEPLOY="false"
SHOW_STATUS="false"
DOCKER_NO_CACHE="${DOCKER_NO_CACHE:-false}"

usage() {
  cat <<'EOF'
Usage: auto-deploy.sh [OPTIONS]

Fetches remote Git changes and deploys only when new commits exist (unless --force is passed).

Options:
  --status        Show local Git commit, remote Git commit, Docker state & live /api/health commit (no deploy)
  --force         Run build & deploy even if HEAD matches upstream
  --no-cache      Pass --no-cache to docker compose build (forces fresh container layers)
  -h, --help      Show this help message

Environment Variables:
  REPO_DIR            Git repository path (default: parent directory of scripts/)
  GIT_REMOTE          Git remote name (default: origin)
  GIT_BRANCH          Target branch (default: current branch, fallback: main)
  DEPLOY_MODE         auto | docker | systemd | custom (default: auto)
  APP_SERVICE         Systemd service name to restart in systemd mode (default: gpx-route-master.service)
  DEPLOY_CMD          Custom shell command run when DEPLOY_MODE=custom
  RUN_TESTS           true | false (default: false) -> runs 'npm run lint && npm test' before deploy
  DOCKER_NO_CACHE     true | false (default: false) -> bypass Docker layer cache during build
  HEALTH_URL          Live health endpoint verified after deploy (default: http://127.0.0.1:3000/api/health)
  VERIFY_HEALTH       true | false (default: true) -> confirm live /api/health reports deployed HEAD commit
  HEALTH_TIMEOUT_SEC  Max seconds to wait for healthy matching commit (default: 30)
  LOCK_FILE           Lock path (default: <REPO_DIR>/.git/gpx-route-master-autodeploy.lock)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --status)
      SHOW_STATUS="true"
      shift
      ;;
    --force)
      FORCE_DEPLOY="true"
      shift
      ;;
    --no-cache)
      DOCKER_NO_CACHE="true"
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
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
VERIFY_HEALTH="${VERIFY_HEALTH:-true}"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-30}"

[[ -d "$REPO_DIR" ]] || die "Repository directory not found: $REPO_DIR"
[[ -d "${REPO_DIR}/.git" ]] || die "Not a git repository: $REPO_DIR"
command -v git >/dev/null 2>&1 || die "git is required"

LOCK_FILE="${LOCK_FILE:-${REPO_DIR}/.git/gpx-route-master-autodeploy.lock}"

case "$DEPLOY_MODE" in
  auto|docker|systemd|custom) ;;
  *) die "Invalid DEPLOY_MODE '$DEPLOY_MODE'. Expected: auto | docker | systemd | custom" ;;
esac

extract_json_field() {
  local json="$1"
  local field="$2"
  if command -v node >/dev/null 2>&1; then
    node -e 'try { const d = JSON.parse(process.argv[1]); process.stdout.write(String(d[process.argv[2]] ?? "")); } catch {}' "$json" "$field" 2>/dev/null || true
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(d.get(sys.argv[2], "") or "", end="")' "$json" "$field" 2>/dev/null || true
  else
    printf '%s' "$json" | sed -n "s/.*\"${field}\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -n 1
  fi
}

run_compose() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    die "Docker Compose is not installed."
  fi
}

resolve_git_branch() {
  if [[ -z "${GIT_BRANCH:-}" ]]; then
    GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    if [[ -z "$GIT_BRANCH" || "$GIT_BRANCH" == "HEAD" ]]; then
      GIT_BRANCH="main"
    fi
  fi
}

show_status() {
  cd "$REPO_DIR"
  resolve_git_branch
  local local_sha short_local remote_sha short_remote dirty fetch_ok
  local_sha="$(git rev-parse HEAD)"
  short_local="$(git rev-parse --short HEAD)"
  dirty="$(git status --porcelain --untracked-files=no)"

  fetch_ok="true"
  if ! git fetch --prune "$GIT_REMOTE" "$GIT_BRANCH" >/dev/null 2>&1; then
    fetch_ok="false"
  fi
  remote_sha="$(git rev-parse "${GIT_REMOTE}/${GIT_BRANCH}" 2>/dev/null || true)"
  short_remote="${remote_sha:0:7}"

  echo "=== GPX Route Master Deployment Status ==="
  echo "Repo:       ${REPO_DIR}"
  echo "Branch:     ${GIT_BRANCH} (remote: ${GIT_REMOTE}/${GIT_BRANCH})"
  echo "Local HEAD: ${short_local} ($(git log -1 --format='%h %s (%ci)' HEAD))"
  if [[ "$fetch_ok" == "true" && -n "$remote_sha" ]]; then
    echo "Remote HEAD:${short_remote:+ ${short_remote}} ($(git log -1 --format='%h %s (%ci)' "${GIT_REMOTE}/${GIT_BRANCH}" 2>/dev/null || echo 'unknown'))"
  else
    echo "Remote HEAD: (fetch failed or offline; cached remote=${short_remote:-none})"
  fi
  if [[ -n "$dirty" ]]; then
    echo "Worktree:   DIRTY (uncommitted changes prevent automatic git pull)"
  else
    echo "Worktree:   clean"
  fi

  if [[ -f "${REPO_DIR}/docker-compose.yml" ]] && command -v docker >/dev/null 2>&1; then
    echo ""
    echo "Docker Containers:"
    docker ps --filter "name=gpx-route-master" --format "  {{.Names}} | {{.Status}} | {{.CreatedAt}}" || true
  fi

  echo ""
  local live_json="" live_commit="" live_version="" live_build=""
  if command -v curl >/dev/null 2>&1; then
    live_json="$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null || true)"
  fi

  if [[ -n "$live_json" ]]; then
    live_commit="$(extract_json_field "$live_json" "commit")"
    live_version="$(extract_json_field "$live_json" "version")"
    live_build="$(extract_json_field "$live_json" "buildTime")"
    echo "Live App (${HEALTH_URL}):"
    echo "  Version:    ${live_version:-unknown}"
    echo "  Commit:     ${live_commit:-unknown}"
    echo "  Build Time: ${live_build:-unknown}"
  else
    echo "Live App (${HEALTH_URL}): unreachable"
  fi

  echo ""
  if [[ -n "$remote_sha" && "$local_sha" != "$remote_sha" ]]; then
    echo "Status: UPDATE AVAILABLE (${short_local} -> ${short_remote}). Run: ${SCRIPT_DIR}/auto-deploy.sh"
  elif [[ -z "$live_json" ]]; then
    echo "Status: GIT AT ${short_local}, LIVE HEALTH UNREACHABLE"
  elif [[ -z "$live_commit" || "$live_commit" == "unknown" || ( "$live_commit" != "${short_local}"* && "${short_local}" != "${live_commit}"* ) ]]; then
    echo "Status: STALE LIVE DEPLOY (Git is at ${short_local}, live service reports commit '${live_commit:-missing}'). Run: ${SCRIPT_DIR}/auto-deploy.sh --force --no-cache"
  else
    echo "Status: UP-TO-DATE (Git & live app both on commit ${live_commit})"
  fi
}

if [[ "$SHOW_STATUS" == "true" ]]; then
  show_status
  exit 0
fi

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
resolve_git_branch

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
    local_short="$(git rev-parse --short HEAD)"
    if [[ "$VERIFY_HEALTH" == "true" ]] && command -v curl >/dev/null 2>&1; then
      live_json="$(curl -fsS --max-time 3 "$HEALTH_URL" 2>/dev/null || true)"
      if [[ -n "$live_json" ]]; then
        live_commit="$(extract_json_field "$live_json" "commit")"
        if [[ -z "$live_commit" || "$live_commit" == "unknown" || ( "$live_commit" != "${local_short}"* && "${local_short}" != "${live_commit}"* ) ]]; then
          log "Git is already at ${local_short}, but live app at ${HEALTH_URL} reports commit '${live_commit:-missing}'. Triggering deploy to sync live service..."
        else
          log "No changes detected on ${GIT_REMOTE}/${GIT_BRANCH} (${local_short}; live commit matches). Skipping deploy."
          exit 0
        fi
      else
        log "No changes detected on ${GIT_REMOTE}/${GIT_BRANCH} (${local_short}). Skipping deploy."
        exit 0
      fi
    else
      log "No changes detected on ${GIT_REMOTE}/${GIT_BRANCH} (${local_short}). Skipping deploy."
      exit 0
    fi
  else
    log "No remote changes (${LOCAL_SHA:0:7}), continuing due to --force."
  fi
else
  log "New commits detected: ${LOCAL_SHA:0:7} -> ${REMOTE_SHA:0:7}"
  git log --oneline "${LOCAL_SHA}..${REMOTE_SHA}" || true
  git pull --ff-only "$GIT_REMOTE" "$GIT_BRANCH"
  log "Pulled updates to $(git rev-parse --short HEAD)."
fi

export APP_GIT_COMMIT="$(git rev-parse --short HEAD)"
export APP_GIT_BRANCH="$GIT_BRANCH"
export APP_BUILD_TIME="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
log "Deploying build metadata: commit=${APP_GIT_COMMIT} branch=${APP_GIT_BRANCH} buildTime=${APP_BUILD_TIME}"

if [[ "$RUN_TESTS" == "true" ]]; then
  command -v npm >/dev/null 2>&1 || die "npm is required when RUN_TESTS=true"
  log "Running pre-deploy typecheck & test suite..."
  npm run lint
  npm test
fi

write_build_info_file() {
  mkdir -p "${REPO_DIR}/dist"
  if command -v node >/dev/null 2>&1; then
    node -e 'const fs = require("fs"); fs.writeFileSync(process.argv[1], JSON.stringify({ commit: process.argv[2], branch: process.argv[3], buildTime: process.argv[4] }, null, 2));' \
      "${REPO_DIR}/dist/build-info.json" "$APP_GIT_COMMIT" "$APP_GIT_BRANCH" "$APP_BUILD_TIME"
  else
    printf '{"commit":"%s","branch":"%s","buildTime":"%s"}\n' "$APP_GIT_COMMIT" "$APP_GIT_BRANCH" "$APP_BUILD_TIME" > "${REPO_DIR}/dist/build-info.json"
  fi
}

deploy_docker() {
  local -a build_args=(
    --build-arg "APP_GIT_COMMIT=${APP_GIT_COMMIT}"
    --build-arg "APP_GIT_BRANCH=${APP_GIT_BRANCH}"
    --build-arg "APP_BUILD_TIME=${APP_BUILD_TIME}"
  )
  if [[ "$DOCKER_NO_CACHE" == "true" ]]; then
    build_args+=(--no-cache)
    log "Docker build with --no-cache enabled..."
  fi
  log "Building Docker image (commit ${APP_GIT_COMMIT})..."
  run_compose build "${build_args[@]}"
  log "Recreating container with 'compose up -d --force-recreate --remove-orphans'..."
  run_compose up -d --force-recreate --remove-orphans
}

deploy_systemd_node() {
  command -v npm >/dev/null 2>&1 || die "npm is required for native Node build"
  log "Installing dependencies & building production bundle..."
  npm install --no-fund
  npm run build
  write_build_info_file

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

verify_live_deployment() {
  if [[ "$VERIFY_HEALTH" != "true" ]]; then
    log "Health verification disabled (VERIFY_HEALTH=${VERIFY_HEALTH})."
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    log "Note: curl not installed; skipping post-deploy /api/health verification."
    return 0
  fi

  log "Verifying live deployment at ${HEALTH_URL} (expected commit: ${APP_GIT_COMMIT}, timeout: ${HEALTH_TIMEOUT_SEC}s)..."
  local deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SEC ))
  local last_commit="" last_version="" last_json=""

  while true; do
    last_json="$(curl -fsS --max-time 3 "$HEALTH_URL" 2>/dev/null || true)"
    if [[ -n "$last_json" ]]; then
      last_commit="$(extract_json_field "$last_json" "commit")"
      last_version="$(extract_json_field "$last_json" "version")"
      if [[ -n "$last_commit" && ( "$last_commit" == "${APP_GIT_COMMIT}"* || "${APP_GIT_COMMIT}" == "${last_commit}"* ) ]]; then
        log "Verified live deployment at ${HEALTH_URL}: version=${last_version:-unknown} commit=${last_commit}"
        return 0
      fi
    fi

    if [[ $(date +%s) -ge $deadline ]]; then
      if [[ -z "$last_json" ]]; then
        die "Post-deploy verification failed: ${HEALTH_URL} did not respond within ${HEALTH_TIMEOUT_SEC}s."
      else
        die "Post-deploy verification failed: live server at ${HEALTH_URL} reports commit '${last_commit:-unknown}' (version ${last_version:-unknown}), expected '${APP_GIT_COMMIT}'. Try './scripts/auto-deploy.sh --force --no-cache'."
      fi
    fi
    sleep 2
  done
}

verify_live_deployment

log "Deploy completed successfully at commit ${APP_GIT_COMMIT}."
