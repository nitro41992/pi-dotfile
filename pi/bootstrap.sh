#!/usr/bin/env bash
set -euo pipefail

# Restore local Pi extension module resolution that cannot be committed because
# node_modules is intentionally ignored. Run this after Pi package install.

PI_AGENT_DIR="${PI_AGENT_DIR:-$HOME/.pi/agent}"
RPIV_TODO_TARGET="$PI_AGENT_DIR/npm/node_modules/@juicesharp/rpiv-todo"
PLAN_MODE_SCOPE_DIR="$PI_AGENT_DIR/extensions/plan-mode/node_modules/@juicesharp"
PLAN_MODE_LINK="$PLAN_MODE_SCOPE_DIR/rpiv-todo"

if [ ! -d "$RPIV_TODO_TARGET" ]; then
  echo "rpiv-todo is not installed at: $RPIV_TODO_TARGET" >&2
  echo "Install Pi packages first, e.g.: pi install npm:@juicesharp/rpiv-todo" >&2
  exit 1
fi

mkdir -p "$PLAN_MODE_SCOPE_DIR"
ln -sfn "$RPIV_TODO_TARGET" "$PLAN_MODE_LINK"

echo "Linked plan-mode rpiv-todo dependency:"
echo "  $PLAN_MODE_LINK -> $RPIV_TODO_TARGET"
