#!/bin/bash
# skillhub CLI wrapper for agent skills management
# Usage: ./usage.sh '<json>'
# Example: ./usage.sh '{"action": "search", "query": "weather"}'

set -e

JSON_INPUT="$1"
SKILLHUB_INSTALL_SCRIPT_URL="https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/install.sh"

run_best_effort() {
    # Run command without breaking outer set -e flow.
    set +e
    "$@"
    local code=$?
    set -e
    return $code
}

try_install_skillhub() {
    if command -v skillhub >/dev/null 2>&1; then
        return 0
    fi
    if ! command -v curl >/dev/null 2>&1; then
        echo "Error: skillhub missing and curl is not available for auto-install"
        return 1
    fi
    if ! command -v bash >/dev/null 2>&1; then
        echo "Error: skillhub missing and bash is not available for auto-install"
        return 1
    fi
    echo "[bootstrap] Installing skillhub CLI..."
    if ! run_best_effort bash -c "curl -fsSL \"$SKILLHUB_INSTALL_SCRIPT_URL\" | bash -s -- --cli-only"; then
        echo "Error: failed to auto-install skillhub CLI"
        return 1
    fi
    if ! command -v skillhub >/dev/null 2>&1; then
        echo "Error: skillhub install finished but command is still unavailable in PATH"
        return 1
    fi
    echo "[bootstrap] skillhub installed"
}

try_install_jq() {
    if command -v jq >/dev/null 2>&1; then
        return 0
    fi
    echo "[bootstrap] jq not found, trying package manager install..."

    if [ "$(uname -s)" = "Darwin" ]; then
        if command -v brew >/dev/null 2>&1 && run_best_effort brew install jq; then
            command -v jq >/dev/null 2>&1 && return 0
        fi
    else
        if command -v apt-get >/dev/null 2>&1; then
            if run_best_effort apt-get update && run_best_effort apt-get install -y jq; then
                command -v jq >/dev/null 2>&1 && return 0
            fi
            if command -v sudo >/dev/null 2>&1; then
                if run_best_effort sudo apt-get update && run_best_effort sudo apt-get install -y jq; then
                    command -v jq >/dev/null 2>&1 && return 0
                fi
            fi
        fi
        if command -v dnf >/dev/null 2>&1 && run_best_effort dnf install -y jq; then
            command -v jq >/dev/null 2>&1 && return 0
        fi
        if command -v yum >/dev/null 2>&1 && run_best_effort yum install -y jq; then
            command -v jq >/dev/null 2>&1 && return 0
        fi
        if command -v apk >/dev/null 2>&1 && run_best_effort apk add --no-cache jq; then
            command -v jq >/dev/null 2>&1 && return 0
        fi
        if command -v pacman >/dev/null 2>&1 && run_best_effort pacman -Sy --noconfirm jq; then
            command -v jq >/dev/null 2>&1 && return 0
        fi
        if command -v zypper >/dev/null 2>&1 && run_best_effort zypper --non-interactive install jq; then
            command -v jq >/dev/null 2>&1 && return 0
        fi
    fi

    if command -v choco >/dev/null 2>&1 && run_best_effort choco install jq -y; then
        command -v jq >/dev/null 2>&1 && return 0
    fi
    if command -v scoop >/dev/null 2>&1 && run_best_effort scoop install jq; then
        command -v jq >/dev/null 2>&1 && return 0
    fi

    echo "Error: failed to auto-install jq with available package managers"
    return 1
}

ensure_dependencies() {
    if ! command -v skillhub >/dev/null 2>&1; then
        try_install_skillhub || return 1
    fi
    if ! command -v jq >/dev/null 2>&1; then
        try_install_jq || return 1
    fi

    if ! command -v skillhub >/dev/null 2>&1; then
        echo "Error: skillhub is still unavailable after bootstrap"
        return 1
    fi
    if ! command -v jq >/dev/null 2>&1; then
        echo "Error: jq is still unavailable after bootstrap"
        return 1
    fi
}

if [ -z "$JSON_INPUT" ]; then
    echo "Usage: ./usage.sh '<json>'"
    echo ""
    echo "Actions:"
    echo "  search       Search skills in the store"
    echo "  install      Install a skill by slug"
    echo "  upgrade      Upgrade installed skills"
    echo "  list         List locally installed skills"
    echo "  self-upgrade Self-upgrade the skillhub CLI"
    echo ""
    echo "Examples:"
    echo "  ./usage.sh '{\"action\": \"search\", \"query\": \"weather\"}'"
    echo "  ./usage.sh '{\"action\": \"install\", \"slug\": \"weather\"}'"
    echo "  ./usage.sh '{\"action\": \"upgrade\"}'"
    echo "  ./usage.sh '{\"action\": \"list\"}'"
    exit 1
fi

ensure_dependencies

# Validate JSON
if ! echo "$JSON_INPUT" | jq empty 2>/dev/null; then
    echo "Error: Invalid JSON input"
    exit 1
fi

# Extract action
ACTION=$(echo "$JSON_INPUT" | jq -r '.action // empty')

if [ -z "$ACTION" ]; then
    echo "Error: 'action' field is required (search, install, upgrade, list, self-upgrade)"
    exit 1
fi

# Validate slug/query: reject values containing shell metacharacters to prevent injection
validate_arg() {
    local arg="$1"
    local name="$2"
    if [ -n "$arg" ] && [[ "$arg" =~ [\"\`\$\\\|\;\&\<\>\(\)] ]]; then
        echo "Error: Invalid characters in '$name' (disallowed for security)"
        exit 1
    fi
}

# Build and execute skillhub command using arrays (no eval)
case "$ACTION" in
    search)
        QUERY=$(echo "$JSON_INPUT" | jq -r '.query // empty')
        LIMIT=$(echo "$JSON_INPUT" | jq -r '.limit // 20')
        TIMEOUT=$(echo "$JSON_INPUT" | jq -r '.timeout // 6')
        JSON_OUTPUT=$(echo "$JSON_INPUT" | jq -r '.json // false')
        validate_arg "$QUERY" "query"
        validate_arg "$LIMIT" "limit"
        validate_arg "$TIMEOUT" "timeout"

        ARGS=(skillhub search)
        [ -n "$QUERY" ] && ARGS+=("$QUERY")
        ARGS+=(--search-limit "$LIMIT" --search-timeout "$TIMEOUT")
        [ "$JSON_OUTPUT" = "true" ] && ARGS+=(--json)
        ;;

    install)
        SLUG=$(echo "$JSON_INPUT" | jq -r '.slug // empty')
        FORCE=$(echo "$JSON_INPUT" | jq -r '.force // false')

        if [ -z "$SLUG" ]; then
            echo "Error: 'slug' is required for install action"
            exit 1
        fi
        validate_arg "$SLUG" "slug"

        ARGS=(skillhub install)
        [ "$FORCE" = "true" ] && ARGS+=(--force)
        ARGS+=("$SLUG")
        ;;

    upgrade)
        SLUG=$(echo "$JSON_INPUT" | jq -r '.slug // empty')
        CHECK_ONLY=$(echo "$JSON_INPUT" | jq -r '.check_only // false')
        TIMEOUT=$(echo "$JSON_INPUT" | jq -r '.timeout // 20')
        validate_arg "$SLUG" "slug"
        validate_arg "$TIMEOUT" "timeout"

        ARGS=(skillhub upgrade)
        [ "$CHECK_ONLY" = "true" ] && ARGS+=(--check-only)
        ARGS+=(--timeout "$TIMEOUT")
        [ -n "$SLUG" ] && ARGS+=("$SLUG")
        ;;

    list)
        ARGS=(skillhub list)
        ;;

    self-upgrade)
        CHECK_ONLY=$(echo "$JSON_INPUT" | jq -r '.check_only // false')
        CURRENT_VERSION=$(echo "$JSON_INPUT" | jq -r '.current_version // empty')
        TIMEOUT=$(echo "$JSON_INPUT" | jq -r '.timeout // 20')
        validate_arg "$CURRENT_VERSION" "current_version"
        validate_arg "$TIMEOUT" "timeout"

        ARGS=(skillhub self-upgrade)
        [ "$CHECK_ONLY" = "true" ] && ARGS+=(--check-only)
        [ -n "$CURRENT_VERSION" ] && ARGS+=(--current-version "$CURRENT_VERSION")
        ARGS+=(--timeout "$TIMEOUT")
        ;;

    *)
        echo "Error: Unknown action '$ACTION'"
        echo "Valid actions: search, install, upgrade, list, self-upgrade"
        exit 1
        ;;
esac

# Execute the command (arguments passed safely, no eval)
"${ARGS[@]}"
