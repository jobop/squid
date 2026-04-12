#!/usr/bin/env bash
set -euo pipefail

MODE="all" # all | cli
KIT_URL="https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/latest.tar.gz"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cli-only)
      MODE="cli"
      shift
      ;;
    --skill-only)
      echo "Error: --skill-only is no longer supported. Skills are synced by TaskAPI startup." >&2
      exit 1
      ;;
    --no-skills|--with-skills)
      echo "Error: --no-skills/--with-skills are no longer supported. Skills are synced by TaskAPI startup." >&2
      exit 1
      ;;
    --kit-url)
      if [[ $# -lt 2 ]]; then
        echo "Error: --kit-url requires a value" >&2
        exit 1
      fi
      KIT_URL="$2"
      shift 2
      ;;
    -h|--help)
      cat <<'USAGE'
Usage: install-skillhub-for-squid.sh [--cli-only] [--kit-url <url>]

Install skillhub CLI for squid.

Defaults:
  mode: all (install CLI)
  kit:  https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/latest.tar.gz

Examples:
  bash scripts/install-skillhub-for-squid.sh
  bash scripts/install-skillhub-for-squid.sh --cli-only
USAGE
      exit 0
      ;;
    *)
      echo "Error: unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 is required." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

curl -fsSL "$KIT_URL" -o "$TMP_DIR/latest.tar.gz"
tar -xzf "$TMP_DIR/latest.tar.gz" -C "$TMP_DIR"

if [[ -d "$TMP_DIR/cli" ]]; then
  CLI_SRC_DIR="$TMP_DIR/cli"
else
  CLI_SRC_DIR="$TMP_DIR"
fi

if [[ ! -f "$CLI_SRC_DIR/skills_store_cli.py" ]]; then
  echo "Error: skills_store_cli.py not found in package" >&2
  exit 1
fi

INSTALL_BASE="${HOME}/.skillhub"
BIN_DIR="${HOME}/.local/bin"
CLI_TARGET="${INSTALL_BASE}/skills_store_cli.py"
UPGRADE_MODULE_TARGET="${INSTALL_BASE}/skills_upgrade.py"
VERSION_TARGET="${INSTALL_BASE}/version.json"
METADATA_TARGET="${INSTALL_BASE}/metadata.json"
CONFIG_TARGET="${INSTALL_BASE}/config.json"
INDEX_TARGET="${INSTALL_BASE}/skills_index.local.json"
WRAPPER_TARGET="${BIN_DIR}/skillhub"
INSTALL_WRAPPER_TARGET="${INSTALL_BASE}/skillhub"
LEGACY_WRAPPER_TARGET="${BIN_DIR}/oc-skills"

install_cli() {
  mkdir -p "$INSTALL_BASE" "$BIN_DIR"
  cp "$CLI_SRC_DIR/skills_store_cli.py" "$CLI_TARGET"
  cp "$CLI_SRC_DIR/skills_upgrade.py" "$UPGRADE_MODULE_TARGET"
  cp "$CLI_SRC_DIR/version.json" "$VERSION_TARGET"
  cp "$CLI_SRC_DIR/metadata.json" "$METADATA_TARGET"
  if [[ -f "$CLI_SRC_DIR/skills_index.local.json" ]]; then
    cp "$CLI_SRC_DIR/skills_index.local.json" "$INDEX_TARGET"
  fi
  chmod +x "$CLI_TARGET"

  if [[ ! -f "$CONFIG_TARGET" ]]; then
    cat > "$CONFIG_TARGET" <<'JSON'
{
  "self_update_url": "https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/version.json",
  "install_workspace_skills": true
}
JSON
  fi

  cat > "$WRAPPER_TARGET" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
BASE="${HOME}/.skillhub"
CLI="${BASE}/skills_store_cli.py"
if [[ ! -f "${CLI}" ]]; then
  echo "Error: CLI not found at ${CLI}" >&2
  exit 1
fi
exec python3 "${CLI}" "$@"
WRAPPER
  chmod +x "$WRAPPER_TARGET"

  cat > "$INSTALL_WRAPPER_TARGET" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
BASE="${HOME}/.skillhub"
CLI="${BASE}/skills_store_cli.py"
if [[ ! -f "${CLI}" ]]; then
  echo "Error: CLI not found at ${CLI}" >&2
  exit 1
fi
exec python3 "${CLI}" "$@"
WRAPPER
  chmod +x "$INSTALL_WRAPPER_TARGET"

  cat > "$LEGACY_WRAPPER_TARGET" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
exec "${HOME}/.local/bin/skillhub" "$@"
WRAPPER
  chmod +x "$LEGACY_WRAPPER_TARGET"
}

if [[ "$MODE" == "all" || "$MODE" == "cli" ]]; then
  install_cli
fi

echo "Install complete."
echo "  mode: $MODE"
if [[ "$MODE" == "all" || "$MODE" == "cli" ]]; then
  echo "  cli: $WRAPPER_TARGET"
  echo "  cli: $INSTALL_WRAPPER_TARGET"
fi
echo
echo "Quick check:"
if [[ "$MODE" == "all" || "$MODE" == "cli" ]]; then
  echo "  command -v skillhub && skillhub --help"
  echo "  test -x $INSTALL_WRAPPER_TARGET && $INSTALL_WRAPPER_TARGET --help"
fi

