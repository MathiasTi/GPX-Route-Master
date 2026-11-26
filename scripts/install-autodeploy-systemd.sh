#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

SERVICE_NAME="gpx-route-master-autodeploy"
ON_CALENDAR="*-*-* 05:00:00"
REPO_DIR="$DEFAULT_REPO_DIR"
GIT_REMOTE="origin"
GIT_BRANCH=""
DEPLOY_MODE="auto"
APP_SERVICE="gpx-route-master.service"
DEPLOY_CMD=""
RUN_TESTS="false"
RUN_AS=""
USER_MODE="false"
DRY_RUN="false"
UNINSTALL="false"

usage() {
  cat <<'EOF'
Usage: install-autodeploy-systemd.sh [OPTIONS]

Installs and enables a daily systemd timer + service that runs scripts/auto-deploy.sh
to pull new Git commits and redeploy if changes exist (default: every day at 05:00).

Options:
  --service-name <name>        Base name for .service/.timer (default: gpx-route-master-autodeploy)
  --time <OnCalendar>          Systemd OnCalendar schedule (default: "*-*-* 05:00:00")
  --repo-dir <path>            Git repo directory (default: parent directory of scripts/)
  --branch <branch>            Git branch to track (default: current branch or main)
  --remote <remote>            Git remote name (default: origin)
  --mode <mode>                auto | docker | systemd | custom (default: auto)
  --app-service <unit>         Service to restart in systemd mode (default: gpx-route-master.service)
  --deploy-cmd <cmd>           Command run when --mode custom is selected
  --run-tests                  Run 'npm run lint && npm test' before deploy (sets RUN_TESTS=true)
  --run-as <user>              Linux user for User= in system mode (default: repo owner)
  --user                       Install as user systemd service (~/.config/systemd/user)
  --dry-run                    Print generated .service and .timer units without installing
  --uninstall                  Stop, disable, and remove the systemd .timer and .service files
  -h, --help                   Show this help message

Examples:
  sudo ./scripts/install-autodeploy-systemd.sh
  sudo ./scripts/install-autodeploy-systemd.sh --mode docker --run-tests
  sudo ./scripts/install-autodeploy-systemd.sh --mode systemd --app-service gpx-route-master.service
  ./scripts/install-autodeploy-systemd.sh --user --dry-run
EOF
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_arg() {
  [[ $# -ge 2 && -n "${2:-}" ]] || die "Option '$1' requires a non-empty value."
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --service-name)
      require_arg "$@"
      SERVICE_NAME="$2"
      shift 2
      ;;
    --time)
      require_arg "$@"
      ON_CALENDAR="$2"
      shift 2
      ;;
    --repo-dir)
      require_arg "$@"
      REPO_DIR="$2"
      shift 2
      ;;
    --branch)
      require_arg "$@"
      GIT_BRANCH="$2"
      shift 2
      ;;
    --remote)
      require_arg "$@"
      GIT_REMOTE="$2"
      shift 2
      ;;
    --mode)
      require_arg "$@"
      DEPLOY_MODE="$2"
      shift 2
      ;;
    --app-service)
      require_arg "$@"
      APP_SERVICE="$2"
      shift 2
      ;;
    --deploy-cmd)
      require_arg "$@"
      DEPLOY_CMD="$2"
      shift 2
      ;;
    --run-tests)
      RUN_TESTS="true"
      shift
      ;;
    --run-as)
      require_arg "$@"
      RUN_AS="$2"
      shift 2
      ;;
    --user)
      USER_MODE="true"
      shift
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    --uninstall)
      UNINSTALL="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1 (run with --help)"
      ;;
  esac
done

# Validate unit name and reject control/newline characters in systemd directives
[[ "$SERVICE_NAME" =~ ^[A-Za-z0-9@._-]+$ ]] || die "Invalid --service-name: '$SERVICE_NAME'"
for val in "$ON_CALENDAR" "$REPO_DIR" "$GIT_REMOTE" "$GIT_BRANCH" "$APP_SERVICE" "$DEPLOY_CMD" "$RUN_AS"; do
  if [[ "$val" == *$'\n'* || "$val" == *$'\r'* ]]; then
    die "Option values cannot contain newlines."
  fi
done

case "$DEPLOY_MODE" in
  auto|docker|systemd|custom) ;;
  *) die "Invalid --mode '$DEPLOY_MODE'. Expected: auto | docker | systemd | custom" ;;
esac

if [[ "$DEPLOY_MODE" == "custom" && -z "$DEPLOY_CMD" && "$UNINSTALL" != "true" ]]; then
  die "--deploy-cmd is required when --mode custom is used."
fi

if [[ "$USER_MODE" == "true" ]]; then
  UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
  SYSTEMCTL_ARGS=(--user)
else
  UNIT_DIR="/etc/systemd/system"
  SYSTEMCTL_ARGS=()
fi

SERVICE_FILE="${UNIT_DIR}/${SERVICE_NAME}.service"
TIMER_FILE="${UNIT_DIR}/${SERVICE_NAME}.timer"

if [[ "$UNINSTALL" == "true" ]]; then
  if [[ "$USER_MODE" != "true" && ${EUID:-$(id -u)} -ne 0 ]]; then
    die "System-wide uninstall requires root privileges. Re-run with sudo or use --user."
  fi
  command -v systemctl >/dev/null 2>&1 || die "systemctl is required to uninstall units."

  systemctl "${SYSTEMCTL_ARGS[@]}" disable --now "${SERVICE_NAME}.timer" >/dev/null 2>&1 || true
  systemctl "${SYSTEMCTL_ARGS[@]}" stop "${SERVICE_NAME}.service" >/dev/null 2>&1 || true
  rm -f "$TIMER_FILE" "$SERVICE_FILE"
  systemctl "${SYSTEMCTL_ARGS[@]}" daemon-reload
  echo "Removed ${SERVICE_FILE} and ${TIMER_FILE} and reloaded systemd."
  exit 0
fi

[[ -d "$REPO_DIR" ]] || die "Repository directory not found: $REPO_DIR"
REPO_DIR="$(cd "$REPO_DIR" && pwd)"
DEPLOY_SCRIPT="${REPO_DIR}/scripts/auto-deploy.sh"
[[ -f "$DEPLOY_SCRIPT" ]] || die "Deploy script not found: $DEPLOY_SCRIPT"

if [[ -z "$GIT_BRANCH" ]]; then
  if command -v git >/dev/null 2>&1 && [[ -d "${REPO_DIR}/.git" ]]; then
    GIT_BRANCH="$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  fi
  if [[ -z "$GIT_BRANCH" || "$GIT_BRANCH" == "HEAD" ]]; then
    GIT_BRANCH="main"
  fi
fi

if [[ "$USER_MODE" != "true" && -z "$RUN_AS" ]]; then
  if stat -c '%U' "$REPO_DIR" >/dev/null 2>&1; then
    RUN_AS="$(stat -c '%U' "$REPO_DIR")"
  elif stat -f '%Su' "$REPO_DIR" >/dev/null 2>&1; then
    RUN_AS="$(stat -f '%Su' "$REPO_DIR")"
  else
    RUN_AS="${SUDO_USER:-$(id -un)}"
  fi
fi

escape_systemd_val() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//%/%%}"
  printf '%s' "$s"
}

ESC_REPO_DIR="$(escape_systemd_val "$REPO_DIR")"
ESC_DEPLOY_SCRIPT="$(escape_systemd_val "$DEPLOY_SCRIPT")"
ESC_REMOTE="$(escape_systemd_val "$GIT_REMOTE")"
ESC_BRANCH="$(escape_systemd_val "$GIT_BRANCH")"
ESC_MODE="$(escape_systemd_val "$DEPLOY_MODE")"
ESC_APP_SERVICE="$(escape_systemd_val "$APP_SERVICE")"
ESC_DEPLOY_CMD="$(escape_systemd_val "$DEPLOY_CMD")"

USER_DIRECTIVE=""
if [[ "$USER_MODE" != "true" && -n "$RUN_AS" ]]; then
  USER_DIRECTIVE="User=${RUN_AS}"$'\n'
fi

CUSTOM_ENV_LINE=""
if [[ -n "$DEPLOY_CMD" ]]; then
  CUSTOM_ENV_LINE="Environment=\"DEPLOY_CMD=${ESC_DEPLOY_CMD}\""$'\n'
fi

SERVICE_CONTENT="[Unit]
Description=GPX Route Master Daily Git Auto-Deploy
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
${USER_DIRECTIVE}WorkingDirectory=\"${ESC_REPO_DIR}\"
Environment=\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\"
Environment=\"REPO_DIR=${ESC_REPO_DIR}\"
Environment=\"GIT_REMOTE=${ESC_REMOTE}\"
Environment=\"GIT_BRANCH=${ESC_BRANCH}\"
Environment=\"DEPLOY_MODE=${ESC_MODE}\"
Environment=\"APP_SERVICE=${ESC_APP_SERVICE}\"
Environment=\"RUN_TESTS=${RUN_TESTS}\"
${CUSTOM_ENV_LINE}ExecStart=/usr/bin/env bash \"${ESC_DEPLOY_SCRIPT}\"
Nice=10
TimeoutStartSec=900
StandardOutput=journal
StandardError=journal
"

TIMER_CONTENT="[Unit]
Description=Daily 05:00 Auto-Deploy Timer for GPX Route Master

[Timer]
OnCalendar=${ON_CALENDAR}
Persistent=true
Unit=${SERVICE_NAME}.service

[Install]
WantedBy=timers.target
"

if [[ "$DRY_RUN" == "true" ]]; then
  echo "=== DRY RUN: ${SERVICE_FILE} ==="
  printf '%s\n' "$SERVICE_CONTENT"
  echo "=== DRY RUN: ${TIMER_FILE} ==="
  printf '%s' "$TIMER_CONTENT"
  exit 0
fi

command -v systemctl >/dev/null 2>&1 || die "systemctl is not available on this host (systemd is required). Re-run with --dry-run to preview unit files."

if [[ "$USER_MODE" != "true" && ${EUID:-$(id -u)} -ne 0 ]]; then
  die "Installing to ${UNIT_DIR} requires root privileges. Re-run with sudo or use --user."
fi

chmod +x "$DEPLOY_SCRIPT"
mkdir -p "$UNIT_DIR"

printf '%s' "$SERVICE_CONTENT" >"$SERVICE_FILE"
printf '%s' "$TIMER_CONTENT" >"$TIMER_FILE"
chmod 644 "$SERVICE_FILE" "$TIMER_FILE"

systemctl "${SYSTEMCTL_ARGS[@]}" daemon-reload
systemctl "${SYSTEMCTL_ARGS[@]}" enable --now "${SERVICE_NAME}.timer"

echo "Installed and enabled ${SERVICE_NAME}.timer (${ON_CALENDAR}):"
echo "  Service: ${SERVICE_FILE}"
echo "  Timer:   ${TIMER_FILE}"
echo ""
systemctl "${SYSTEMCTL_ARGS[@]}" list-timers --all "${SERVICE_NAME}.timer" || true
echo ""
echo "Useful commands:"
if [[ "$USER_MODE" == "true" ]]; then
  echo "  Test now:   systemctl --user start ${SERVICE_NAME}.service"
  echo "  View logs:  journalctl --user -u ${SERVICE_NAME}.service -n 100 --no-pager"
else
  echo "  Test now:   sudo systemctl start ${SERVICE_NAME}.service"
  echo "  View logs:  sudo journalctl -u ${SERVICE_NAME}.service -n 100 --no-pager"
fi
