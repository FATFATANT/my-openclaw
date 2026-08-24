#!/usr/bin/env bash
set -euo pipefail

CLAW_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAW_LLM_FILE="${CLAW_LLM_FILE:-$CLAW_ROOT/.llm}"
CLAW_CONFIG_FILE="${CLAW_CONFIG_FILE:-$CLAW_ROOT/openclaw.workbench.json5}"
CLAW_RUNTIME_DIR="$CLAW_ROOT/.workbench-local"
CLAW_PID_FILE="$CLAW_RUNTIME_DIR/gateway.pid"
CLAW_LOG_FILE="$CLAW_RUNTIME_DIR/gateway.log"
CLAW_GATEWAY_TOKEN_FILE="$CLAW_RUNTIME_DIR/gateway-token"
CLAW_BUILD_STAMP="$CLAW_RUNTIME_DIR/build-stamp"
CLAW_PORT="${CLAW_PORT:-18789}"

read_value() {
  local file="$1" key="$2" line value
  [[ -f "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*$ || "$line" =~ ^[[:space:]]*# || "$line" != *=* ]] && continue
    if [[ "${line%%=*}" == "$key" ]]; then
      value="${line#*=}"
      value="${value#"${value%%[![:space:]]*}"}"
      value="${value%"${value##*[![:space:]]}"}"
      printf '%s' "$value"
      return 0
    fi
  done < "$file"
}

listener_pid() {
  lsof -tiTCP:"$CLAW_PORT" -sTCP:LISTEN -nP 2>/dev/null | head -n 1
}

resolve_node() {
  if [[ -n "${OPENCLAW_NODE_BIN:-}" && -x "$OPENCLAW_NODE_BIN" ]]; then
    printf '%s' "$OPENCLAW_NODE_BIN"
    return
  fi
  local nvm_dir="${NVM_DIR:-$HOME/.nvm}" nvm_node requested_version
  if [[ -s "$nvm_dir/nvm.sh" && -f "$CLAW_ROOT/.nvmrc" ]]; then
    requested_version="$(tr -d '[:space:]' < "$CLAW_ROOT/.nvmrc")"
    nvm_node="$({
      export NVM_DIR="$nvm_dir"
      # shellcheck disable=SC1090
      source "$nvm_dir/nvm.sh" --no-use
      nvm which "$requested_version" 2>/dev/null
    } || true)"
    if [[ -n "$nvm_node" && -x "$nvm_node" ]]; then
      printf '%s' "$nvm_node"
      return
    fi
  fi
  command -v node >/dev/null && command -v node || return 1
}

check_node() {
  local node_bin="$1" version major minor
  version="$($node_bin -p 'process.versions.node')"
  major="${version%%.*}"
  minor="${version#*.}"
  minor="${minor%%.*}"
  if ! { (( major == 22 && minor >= 22 )) || (( major == 24 && minor >= 15 )) || (( major == 25 && minor >= 9 )) || (( major > 25 )); }; then
    echo "OpenClaw requires Node >=22.22.3 or >=24.15.0; current: $version" >&2
    echo "Run 'nvm install' in $CLAW_ROOT, or set OPENCLAW_NODE_BIN to a compatible node executable." >&2
    exit 1
  fi
}

build_is_stale() {
  [[ -f "$CLAW_ROOT/dist/entry.js" || -f "$CLAW_ROOT/dist/entry.mjs" ]] || return 0
  [[ -f "$CLAW_BUILD_STAMP" ]] || return 0
  find "$CLAW_ROOT/src" "$CLAW_ROOT/packages" "$CLAW_ROOT/extensions" "$CLAW_ROOT/ui" \
    -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.json' \) \
    -newer "$CLAW_BUILD_STAMP" -print -quit | grep -q .
}

ensure_build() {
  local node_bin="$1"
  local runtime_path="$(dirname "$node_bin"):$PATH"
  local pnpm_bin=""
  build_is_stale || return 0
  pnpm_bin="$(PATH="$runtime_path" command -v pnpm 2>/dev/null || true)"
  [[ -n "$pnpm_bin" ]] || { echo "pnpm is required to build OpenClaw" >&2; exit 1; }
  echo "OpenClaw source changed; rebuilding ..."
  (cd "$CLAW_ROOT" && PATH="$runtime_path" "$pnpm_bin" build)
  touch "$CLAW_BUILD_STAMP"
}

load_secrets() {
  [[ -f "$CLAW_LLM_FILE" ]] || {
    echo "Missing $CLAW_LLM_FILE; create it with: cp '$CLAW_ROOT/.llm.example' '$CLAW_LLM_FILE'" >&2
    exit 1
  }
  DEEPSEEK_API_KEY="$(read_value "$CLAW_LLM_FILE" api_key)"
  AI_WORKBENCH_SHARED_TOKEN_SECRET="${AI_WORKBENCH_SHARED_TOKEN_SECRET:-$(read_value "$CLAW_LLM_FILE" workbench_token_secret)}"
  [[ -n "$DEEPSEEK_API_KEY" ]] || { echo "api_key is missing in $CLAW_LLM_FILE" >&2; exit 1; }
  [[ ${#AI_WORKBENCH_SHARED_TOKEN_SECRET} -ge 16 ]] || {
    echo "workbench_token_secret is missing or too short in $CLAW_LLM_FILE" >&2
    echo "Set it to the same value as AI_WORKBENCH_SHARED_TOKEN_SECRET in the workbench .myenv file." >&2
    exit 1
  }
  export DEEPSEEK_API_KEY AI_WORKBENCH_SHARED_TOKEN_SECRET
  mkdir -p "$CLAW_RUNTIME_DIR"
  if [[ ! -s "$CLAW_GATEWAY_TOKEN_FILE" ]]; then
    command -v openssl >/dev/null || { echo "openssl is required to create the Gateway token" >&2; exit 1; }
    umask 077
    openssl rand -hex 32 > "$CLAW_GATEWAY_TOKEN_FILE"
  fi
  OPENCLAW_GATEWAY_TOKEN="$(<"$CLAW_GATEWAY_TOKEN_FILE")"
  export OPENCLAW_GATEWAY_TOKEN
  export OPENCLAW_CONFIG_PATH="$CLAW_CONFIG_FILE"
  export OPENCLAW_STATE_DIR="$CLAW_RUNTIME_DIR/state"
  export OPENCLAW_WORKBENCH_AGENT_ROOT="${OPENCLAW_WORKBENCH_AGENT_ROOT:-$CLAW_ROOT/workbench-agents}"
  export OPENCLAW_WORKBENCH_MCP_URL="${OPENCLAW_WORKBENCH_MCP_URL:-http://127.0.0.1:8080/mcp}"
}

start() {
  local existing node_bin
  existing="$(listener_pid || true)"
  if [[ -n "$existing" ]]; then
    echo "OpenClaw already listening on $CLAW_PORT (pid $existing)"
    return
  fi
  node_bin="$(resolve_node)" || { echo "Node.js is required" >&2; exit 1; }
  check_node "$node_bin"
  load_secrets
  [[ -d "$CLAW_ROOT/node_modules" ]] || {
    echo "Dependencies are missing. Run pnpm install in $CLAW_ROOT first." >&2
    exit 1
  }
  ensure_build "$node_bin"
  mkdir -p "$CLAW_RUNTIME_DIR/state"
  : > "$CLAW_LOG_FILE"
  (
    cd "$CLAW_ROOT"
    nohup "$node_bin" openclaw.mjs gateway --port "$CLAW_PORT" --bind loopback \
      > "$CLAW_LOG_FILE" 2>&1 < /dev/null &
    echo $! > "$CLAW_PID_FILE"
  )
  for _ in {1..90}; do
    existing="$(listener_pid || true)"
    if [[ -n "$existing" ]] && grep -q "\[gateway\].*ready" "$CLAW_LOG_FILE" 2>/dev/null; then
      echo "OpenClaw started: http://127.0.0.1:$CLAW_PORT (pid $existing)"
      return
    fi
    kill -0 "$(<"$CLAW_PID_FILE")" 2>/dev/null || {
      echo "OpenClaw exited; see $CLAW_LOG_FILE" >&2
      exit 1
    }
    sleep 1
  done
  echo "OpenClaw did not listen on $CLAW_PORT; see $CLAW_LOG_FILE" >&2
  exit 1
}

stop() {
  local pid=""
  if [[ -f "$CLAW_PID_FILE" ]]; then
    pid="$(<"$CLAW_PID_FILE")"
  else
    pid="$(listener_pid || true)"
  fi
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    echo "Stopping OpenClaw (pid $pid)"
    kill "$pid"
    for _ in {1..30}; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    if kill -0 "$pid" 2>/dev/null; then
      echo "OpenClaw did not stop within 30 seconds (pid $pid)" >&2
      exit 1
    fi
  fi
  rm -f "$CLAW_PID_FILE"
}

status() {
  local pid
  pid="$(listener_pid || true)"
  if [[ -n "$pid" ]]; then
    echo "OpenClaw: running pid=$pid http://127.0.0.1:$CLAW_PORT"
  else
    echo "OpenClaw: stopped http://127.0.0.1:$CLAW_PORT"
  fi
}

dashboard() {
  local node_bin
  node_bin="$(resolve_node)" || { echo "Node.js is required" >&2; exit 1; }
  check_node "$node_bin"
  load_secrets
  cd "$CLAW_ROOT"
  "$node_bin" openclaw.mjs dashboard --no-open
}

case "${1:-start}" in
  start) start ;;
  serve) trap 'stop; exit 0' INT TERM; start; while true; do sleep 5; done ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  dashboard) dashboard ;;
  logs) echo "$CLAW_LOG_FILE" ;;
  *) echo "Usage: $0 [start|serve|stop|restart|status|dashboard|logs]" >&2; exit 2 ;;
esac
