#!/usr/bin/env bash
# Shoot every screen listed in the project's screens file, print the ones marked pdf,
# and total the console/network problems. Exits non-zero if any screen had one.
#
#   sweep.sh <base-url> <out-dir> [id ...]
#
# The screens file is $GOAL_LOOP_DIR/screens (by default .claude/goal-loop/screens), or $SCREENS.
# One screen per line: a name, a path under the base URL, a viewport, then any cdp.mjs flags
# (quotes are honoured, so --js "…" works):
#
#   home            /                    desktop --full
#   phone-home      /                    phone
#   {id}-edit       /d/{id}?view=edit    desktop --full
#   {id}-phone      /d/{id}?view=live    phone --scroll
#   {id}            /d/{id}?view=page    pdf
#
# Viewports: desktop (1440x900), tablet (820x1180, touch), phone (390x844, touch), any WxH, or pdf
# (prints <name>.pdf and, on macOS, renders its pages into <name>-pdf.png).
# A line with {id} is repeated for every id given on the command line, and skipped when none are.
# Directives:
#   @pane <css selector>              the element the app scrolls in, when the page itself doesn't
#   @viewport <alias> <cdp.mjs flags> define or redefine a viewport, e.g. @viewport wide --size 1920x1080
#   @wait <ms>                        how long each page settles before the shot (default 3500)
here="$(cd "$(dirname "$0")" && pwd)"
base="${1:?base url}"; out="${2:?out dir}"; shift 2
base="${base%/}"
ids=("$@")
root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
file="${SCREENS:-${GOAL_LOOP_DIR:-$root/.claude/goal-loop}/screens}"
if [ ! -f "$file" ]; then
  echo "no screens file at $file; write one (see templates/screens in the goal-loop skill)"
  exit 2
fi
mkdir -p "$out"
problems=0
wait=3500
vp_desktop="--size 1440x900"
vp_tablet="--size 820x1180 --mobile"
vp_phone="--size 390x844 --mobile"

viewport() { # alias → cdp.mjs flags, or empty when unknown
  case "$1" in
    [0-9]*x[0-9]*) echo "--size $1" ;;
    *[!A-Za-z0-9_]*) ;;
    *) eval "echo \"\${vp_$1-}\"" ;;
  esac
}

count() { # output → problems seen, with the lines worth reading
  local n; n=$(grep -c '^CONSOLE' <<<"$1")
  problems=$((problems + n))
  printf '%-28s %s\n' "$2" "$([ "$n" = 0 ] && echo ok || echo "$n problem(s)")"
  grep -E '^(CONSOLE|JS|THEN|PRESS)|timeout|not start|not found' <<<"$1" | sed 's/^/    /'
}

screen() { # name path viewport [flags…]
  local name="$1" path="$2" vp="$3"; shift 3
  local res
  if [ "$vp" = pdf ]; then
    res="$(node "$here/cdp.mjs" pdf "$base$path" "$out/$name.pdf" "$@" --wait "$wait" 2>&1 </dev/null)"
    count "$res" "$name.pdf"
    if command -v swift >/dev/null && [ -f "$out/$name.pdf" ]; then
      swift "$here/pdfpng.swift" "$out/$name.pdf" "$out/$name-pdf.png" 2>/dev/null </dev/null | sed 's/^/    /'
    fi
    return
  fi
  local size; size="$(viewport "$vp")"
  if [ -z "$size" ]; then
    echo "$name: unknown viewport '$vp'"; problems=$((problems + 1)); return
  fi
  # shellcheck disable=SC2086
  res="$(node "$here/cdp.mjs" shot "$base$path" "$out/$name.png" $size "$@" --wait "$wait" 2>&1 </dev/null)"
  count "$res" "$name"
}

run() { # one line of the screens file, ids already substituted
  eval "set -- $1"
  [ $# -ge 3 ] || { echo "skipped, needs name, path and viewport: $1"; return; }
  screen "$@"
}

while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"
  line="${line#"${line%%[![:space:]]*}"}"
  case "$line" in
    ''|'#'*) continue ;;
    @pane\ *) export CDP_PANE="${line#@pane }" ;;
    @wait\ *) wait="${line#@wait }" ;;
    @viewport\ *)
      read -r alias flags <<<"${line#@viewport }"
      case "$alias" in ''|*[!A-Za-z0-9_]*) echo "bad viewport name: $alias"; continue ;; esac
      eval "vp_$alias=\"\$flags\"" ;;
    *'{id}'*)
      for id in "${ids[@]}"; do run "${line//\{id\}/$id}"; done ;;
    *) run "$line" ;;
  esac
done <"$file"
echo "screens in $out: $problems problem(s)"
[ "$problems" = 0 ]
