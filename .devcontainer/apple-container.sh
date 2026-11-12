#!/usr/bin/env bash
# Runs this dev container with Apple's `container` CLI (no Docker needed).
# Mirrors .devcontainer/devcontainer.json; keep the two in sync.
# Usage: apple-container.sh [up|shell|down|rm]
set -euo pipefail

IMAGE="mcr.microsoft.com/devcontainers/javascript-node:5-26-bookworm"
REMOTE_USER="node"
PORTS=(5173 4173)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME="$(basename "$ROOT")-dev"
WORKDIR="/workspaces/$(basename "$ROOT")"
VOLUME="$NAME-node_modules"

state() { container inspect "$NAME" 2>/dev/null | jq -r '.[0].status.state // empty' || true; }

# Attaching to an Apple container ignores devcontainer.json, so install the VS Code
# server (matching the local VS Code) and the extensions ourselves, before attaching.
seed_vscode() {
  local commit exts
  commit="$(code --version 2>/dev/null | sed -n 2p || true)"
  if [ -z "$commit" ]; then
    echo "'code' not on PATH; skipping VS Code server/extension setup" >&2
    return
  fi
  exts="$(sed -n '/"extensions"/,/\]/p' "$ROOT/.devcontainer/devcontainer.json" \
    | grep -o '"[A-Za-z0-9-]*\.[A-Za-z0-9-]*"' | tr -d '"' | tr '\n' ' ')"

  container exec -u "$REMOTE_USER" -e "COMMIT=$commit" -e "EXTS=$exts" "$NAME" bash -c '
    set -euo pipefail
    dir="$HOME/.vscode-server/bin/$COMMIT"
    if [ ! -x "$dir/bin/code-server" ]; then
      case "$(uname -m)" in aarch64) arch=arm64 ;; *) arch=x64 ;; esac
      mkdir -p "$dir"
      curl -fsSL "https://update.code.visualstudio.com/commit:$COMMIT/server-linux-$arch/stable" \
        | tar -xz --strip-components=1 -C "$dir"
    fi
    for ext in $EXTS; do
      "$dir/bin/code-server" --install-extension "$ext" >/dev/null
    done
    echo "VS Code server and extensions ready: $EXTS"
  '
}

up() {
  case "$(state)" in
    running) echo "$NAME already running" ;;
    stopped) container start "$NAME" ;;
    *) create ;;
  esac
  seed_vscode
  echo "Ready. In VS Code: 'Dev Containers: Attach to Running Apple Container...' -> $NAME"
}

create() {
  container volume inspect "$VOLUME" >/dev/null 2>&1 || container volume create "$VOLUME"

  local publish=()
  for p in "${PORTS[@]}"; do publish+=(-p "$p:$p"); done

  container run -d --name "$NAME" -u "$REMOTE_USER" \
    --mount "type=bind,source=$ROOT,target=$WORKDIR" \
    -v "$VOLUME:$WORKDIR/node_modules" \
    "${publish[@]}" \
    -w "$WORKDIR" \
    "$IMAGE" sleep infinity

  if ! container exec -u "$REMOTE_USER" -w "$WORKDIR" "$NAME" bash .devcontainer/post-create.sh; then
    echo "post-create.sh failed; removing $NAME so the next 'up' retries" >&2
    container delete --force "$NAME" >/dev/null 2>&1 || true
    exit 1
  fi
}

case "${1:-up}" in
  up) up ;;
  shell) container exec -it -w "$WORKDIR" "$NAME" bash ;;
  down) container stop "$NAME" ;;
  rm) container delete --force "$NAME" 2>/dev/null || true; container volume delete "$VOLUME" 2>/dev/null || true ;;
  *) echo "usage: $0 [up|shell|down|rm]" >&2; exit 1 ;;
esac
