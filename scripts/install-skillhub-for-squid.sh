#!/usr/bin/env bash
set -euo pipefail

MODE="all" # all | cli | skill
INSTALL_SKILLS=1
KIT_URL="https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/latest.tar.gz"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLED_SKILLS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)/skills"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cli-only)
      MODE="cli"
      shift
      ;;
    --skill-only)
      MODE="skill"
      shift
      ;;
    --no-skills)
      INSTALL_SKILLS=0
      shift
      ;;
    --with-skills)
      INSTALL_SKILLS=1
      shift
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
Usage: install-skillhub-for-squid.sh [--cli-only|--skill-only] [--no-skills|--with-skills] [--kit-url <url>]

Install skillhub CLI and optional skill templates for squid.

Defaults:
  mode: all (install CLI + skills)
  kit:  https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/latest.tar.gz

Examples:
  bash scripts/install-skillhub-for-squid.sh
  bash scripts/install-skillhub-for-squid.sh --cli-only
  bash scripts/install-skillhub-for-squid.sh --skill-only --with-skills
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
LEGACY_WRAPPER_TARGET="${BIN_DIR}/oc-skills"

SQUID_SKILLS_DIR="${HOME}/.squid/skills"
FIND_SKILL_TARGET_DIR="${SQUID_SKILLS_DIR}/find-skills"
PREFERENCE_SKILL_TARGET_DIR="${SQUID_SKILLS_DIR}/skillhub-preference"

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

  cat > "$LEGACY_WRAPPER_TARGET" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
exec "${HOME}/.local/bin/skillhub" "$@"
WRAPPER
  chmod +x "$LEGACY_WRAPPER_TARGET"
}

install_skills_for_squid() {
  local bundled_find_skill_src="$BUNDLED_SKILLS_DIR/find-skills/SKILL.md"
  local remote_find_skill_src="$CLI_SRC_DIR/skill/SKILL.md"
  local find_skill_src="$remote_find_skill_src"
  local preference_skill_src="$CLI_SRC_DIR/skill/SKILL.skillhub-preference.md"
  local installed=0

  if [[ -f "$bundled_find_skill_src" ]]; then
    find_skill_src="$bundled_find_skill_src"
  fi

  if [[ -f "$find_skill_src" ]]; then
    mkdir -p "$FIND_SKILL_TARGET_DIR"
    cp "$find_skill_src" "$FIND_SKILL_TARGET_DIR/SKILL.md"
    installed=1
  else
    echo "Warn: find-skills template not found (bundled=$bundled_find_skill_src, remote=$remote_find_skill_src)" >&2
  fi

  if [[ -f "$preference_skill_src" ]]; then
    mkdir -p "$PREFERENCE_SKILL_TARGET_DIR"
    cp "$preference_skill_src" "$PREFERENCE_SKILL_TARGET_DIR/SKILL.md"
    installed=1
  fi

  if [[ "$installed" -ne 1 ]]; then
    echo "Warn: no skill templates installed." >&2
  fi
}

if [[ "$MODE" == "all" || "$MODE" == "cli" ]]; then
  install_cli
fi

if [[ "$MODE" == "all" || "$MODE" == "skill" ]]; then
  if [[ "$INSTALL_SKILLS" -eq 1 ]]; then
    install_skills_for_squid
  else
    echo "Info: skipped skill template installation by --no-skills"
  fi
fi

echo "Install complete."
echo "  mode: $MODE"
if [[ "$MODE" == "all" || "$MODE" == "cli" ]]; then
  echo "  cli: $WRAPPER_TARGET"
fi
if [[ "$MODE" == "all" || "$MODE" == "skill" ]]; then
  if [[ "$INSTALL_SKILLS" -eq 1 ]]; then
    echo "  skill: $FIND_SKILL_TARGET_DIR/SKILL.md"
    if [[ -f "$PREFERENCE_SKILL_TARGET_DIR/SKILL.md" ]]; then
      echo "  skill: $PREFERENCE_SKILL_TARGET_DIR/SKILL.md"
    fi
  else
    echo "  skill: skipped (--no-skills)"
  fi
fi
echo
echo "Quick check:"
if [[ "$MODE" == "all" || "$MODE" == "cli" ]]; then
  echo "  command -v skillhub && skillhub --help"
fi
if [[ "$MODE" == "all" || "$MODE" == "skill" ]]; then
  if [[ "$INSTALL_SKILLS" -eq 1 ]]; then
    echo "  test -f $FIND_SKILL_TARGET_DIR/SKILL.md && echo find-skills-installed"
  fi
fi

