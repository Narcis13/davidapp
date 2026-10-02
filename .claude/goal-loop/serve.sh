#!/usr/bin/env bash
# Run the studio in isolation for verification: its own port and its own data directory.
#
#   serve.sh fresh <port> <data-dir>   wipe the data dir, start the server, wait until it answers
#   serve.sh start <port> <data-dir>   start on existing data
#   serve.sh seed  <port> <data-dir>   fresh + rebuild the showcase library and clips (no renders)
#   serve.sh stop  <port> <data-dir>   stop it
#
# The server log is <data-dir>/server.log; it must contain no line starting with ERROR.
set -u
cmd="${1:?fresh|start|seed|stop}"; port="${2:?port}"; dir="${3:?data dir}"
root="$(git rev-parse --show-toplevel)"
stop() {
  if [ -f "$dir/server.pid" ]; then
    pid="$(cat "$dir/server.pid")"
    if command -v taskkill >/dev/null 2>&1; then taskkill //F //PID "$pid" >/dev/null 2>&1; else kill "$pid" 2>/dev/null; fi
    rm -f "$dir/server.pid"
    sleep 0.5
  fi
}
start() {
  mkdir -p "$dir"
  ( cd "$root" && STUDIO_DATA="$dir" PORT="$port" node src/server/index.js >>"$dir/server.log" 2>&1 & )
  for _ in $(seq 1 80); do
    if curl -sf "http://127.0.0.1:$port/api/status" >/dev/null 2>&1; then echo "studio up: http://127.0.0.1:$port (data: $dir)"; return 0; fi
    sleep 0.25
  done
  echo "the studio did not start; see $dir/server.log"; tail -n 20 "$dir/server.log"; return 1
}
case "$cmd" in
  stop) stop ;;
  start) stop; start ;;
  fresh) stop; rm -rf "$dir"; start ;;
  seed) stop; rm -rf "$dir"; mkdir -p "$dir"; ( cd "$root" && STUDIO_DATA="$dir" node showcase/build.mjs --no-render ) && start ;;
  *) echo "usage: serve.sh fresh|start|seed|stop <port> <data-dir>"; exit 2 ;;
esac
