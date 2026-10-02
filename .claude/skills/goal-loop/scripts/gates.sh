#!/usr/bin/env bash
# The gates every milestone must pass, read from the project's gates file
# ($GOAL_LOOP_DIR/gates, by default .claude/goal-loop/gates in the repository).
# Runs all of them (a failure doesn't hide the next one), prints one summary line each,
# and exits non-zero if any failed. Full output of every gate is in $LOGS/<name>.log.
#
# The gates file has one gate per line, a name and then a shell command run from the repo root:
#
#   typecheck  npm run --silent typecheck
#   test       npm test --silent
#   build      npx vite build --outDir "$LOGS/dist" --emptyOutDir
#
# and two optional directives:
#
#   @summary <gate> <regex>            print the lines of that gate's log that match (e.g. test counts)
#   @warn <gate> <regex> <message>     a match in that gate's log prints WARN <message>: a finding, not a pass
#                                      (the regex is one word; write spaces as . or \s)
#
# $LOGS is exported, so a build can go there instead of over a build a running server uses.
root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$root" || exit 1
file="${GOAL_LOOP_DIR:-$root/.claude/goal-loop}/gates"
if [ ! -f "$file" ]; then
  echo "no gates file at $file; write one (see templates/gates in the goal-loop skill)"
  exit 2
fi
export LOGS="${LOGS:-${TMPDIR:-/tmp}/goal-loop-gates}"
mkdir -p "$LOGS"
fail=0
summaries=""
warns=""
gate() {
  local name="$1" cmd="$2"
  local start=$SECONDS
  if bash -c "$cmd" >"$LOGS/$name.log" 2>&1 </dev/null; then
    echo "PASS  $name  ($((SECONDS - start))s)"
  else
    fail=1
    echo "FAIL  $name  ($((SECONDS - start))s)  → $LOGS/$name.log"
    tail -n 25 "$LOGS/$name.log" | sed 's/^/      /'
  fi
}
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"
  line="${line#"${line%%[![:space:]]*}"}"
  case "$line" in
    ''|'#'*) continue ;;
    @summary\ *) summaries="$summaries${line#@summary }"$'\n' ;;
    @warn\ *) warns="$warns${line#@warn }"$'\n' ;;
    *) read -r name cmd <<<"$line"; gate "$name" "$cmd" ;;
  esac
done <"$file"
while IFS= read -r s; do
  [ -n "$s" ] || continue
  read -r name re <<<"$s"
  [ -f "$LOGS/$name.log" ] && { grep -E "$re" "$LOGS/$name.log" | tr '\n' ' '; echo; }
done <<<"$summaries"
while IFS= read -r w; do
  [ -n "$w" ] || continue
  read -r name re msg <<<"$w"
  [ -f "$LOGS/$name.log" ] && grep -iE "$re" "$LOGS/$name.log" >/dev/null && echo "WARN  $name: ${msg:-$re} (see $LOGS/$name.log)"
done <<<"$warns"
exit $fail
