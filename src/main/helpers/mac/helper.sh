#!/bin/sh
# WhipZap macOS helper (osascript / System Events). POSIX sh, no dependencies beyond macOS.
# UNVERIFIED-ON-HARDWARE: run docs/TESTING.md section 6.2 on a Mac before trusting it.
#
# Usage: /bin/sh helper.sh <command> [args]     text (for `type`) arrives on STDIN as UTF-8.
#   check                  -> {"ok":true}  or code 2 when Accessibility (or Automation) is not granted
#   foreground             -> {"ok":true,"id":"pid:N","title":"...","processName":"...","pid":N}
#   info pid:N             -> same shape for that process, code 3 if there is no such process
#   focus pid:N            -> {"ok":true} after the process is frontmost, code 5 if it never became frontmost
#   type pid:N [--enter]   -> verifies pid:N is frontmost (else code 3), types stdin, then Enter with --enter
# Output: exactly one JSON object on stdout. Exit code = error code on failure.
# Codes: 1 other, 2 permission, 3 target gone, 4 unsupported, 5 focus failed.
#
# Safety (D-1): the only keys ever synthesised are the message characters via `keystroke` and
# Enter via `key code 36`. No modifiers, no Esc, no Ctrl-C. Non-ASCII text goes through `keystroke`
# as well; characters absent from the active keyboard layout may be dropped by System Events.
# The built-in pack is ASCII, so only user-added lines are affected. The clipboard is never touched (NFR-14).
set -u

json_str() {
  tab=$(printf '\t')
  printf '%s' "$1" | tr -d '\r\000-\010\013-\037' \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e "s/$tab/\\\\t/g" \
    | awk 'BEGIN{ORS=""} NR>1{printf "\\n"} {printf "%s",$0}'
}

fail() {
  printf '{"ok":false,"code":%d,"error":"%s"}\n' "$1" "$(json_str "$2")"
  exit "$1"
}

# Runs osascript with the given -e statements, captures stderr, maps known errors to codes.
run_as() {
  err=$(osascript "$@" 2>&1 >/dev/null) && return 0
  case "$err" in
    *"not allowed assistive access"*|*"-1719"*|*"-25211"*) fail 2 "Accessibility permission required: $err" ;;
    *"Not authorized to send Apple events"*|*"-1743"*) fail 2 "Automation permission required: $err" ;;
    *"Can't get"*|*"Can’t get"*) fail 3 "No such process: $err" ;;
    *) fail 1 "osascript failed: $err" ;;
  esac
}

# Prints three lines for a process: unix id, name, front window title (may be empty).
describe_script() {
  # $1 is an AppleScript expression selecting the process
  printf 'tell application "System Events"\nset p to %s\nset t to ""\ntry\nset t to name of front window of p\nend try\nreturn (unix id of p as text) & linefeed & (name of p) & linefeed & t\nend tell\n' "$1"
}

describe() {
  out=$(osascript -e "$(describe_script "$1")" 2>&1) || {
    case "$out" in
      *"not allowed assistive access"*|*"-1719"*|*"-25211"*) fail 2 "Accessibility permission required: $out" ;;
      *"Can't get"*|*"Can’t get"*) fail 3 "No such process: $out" ;;
      *) fail 1 "osascript failed: $out" ;;
    esac
  }
  pid=$(printf '%s\n' "$out" | sed -n '1p')
  name=$(printf '%s\n' "$out" | sed -n '2p')
  title=$(printf '%s\n' "$out" | sed -n '3,$p')
  printf '{"ok":true,"id":"pid:%s","title":"%s","processName":"%s","pid":%s}\n' \
    "$pid" "$(json_str "$title")" "$(json_str "$name")" "${pid:-0}"
}

frontmost_pid() {
  osascript -e 'tell application "System Events" to get unix id of first application process whose frontmost is true' 2>/dev/null
}

pid_from_id() {
  case "$1" in
    pid:*) printf '%s' "${1#pid:}" ;;
    *) fail 3 "window id must look like pid:<n>, got $1" ;;
  esac
}

cmd=${1:-}
case "$cmd" in
  check)
    # Process listing needs Automation consent for System Events; an empty keystroke needs Accessibility.
    run_as -e 'tell application "System Events" to get name of first application process'
    run_as -e 'tell application "System Events" to keystroke ""'
    printf '{"ok":true}\n'
    ;;
  foreground)
    describe 'first application process whose frontmost is true'
    ;;
  info)
    n=$(pid_from_id "${2:-}")
    describe "first application process whose unix id is $n"
    ;;
  focus)
    n=$(pid_from_id "${2:-}")
    run_as -e "tell application \"System Events\" to set frontmost of (first application process whose unix id is $n) to true"
    i=0
    while [ "$i" -lt 5 ]; do
      [ "$(frontmost_pid)" = "$n" ] && { printf '{"ok":true}\n'; exit 0; }
      sleep 0.05
      i=$((i + 1))
    done
    fail 5 "process $n did not become frontmost"
    ;;
  type)
    n=$(pid_from_id "${2:-}")
    enter=0
    [ "${3:-}" = "--enter" ] && enter=1
    text=$(cat)
    [ "$(frontmost_pid)" = "$n" ] || fail 3 "target process $n is not frontmost"
    # Chunk at 200 characters so a single keystroke call stays well inside osascript limits.
    printf '%s\n' "$text" | fold -w 200 | while IFS= read -r chunk; do
      [ -n "$chunk" ] || continue
      run_as -e 'on run argv' -e 'tell application "System Events" to keystroke (item 1 of argv)' -e 'end run' -- "$chunk"
    done || exit $?
    if [ "$enter" -eq 1 ]; then
      run_as -e 'tell application "System Events" to key code 36'
    fi
    printf '{"ok":true,"typed":%d}\n' "${#text}"
    ;;
  *)
    fail 4 "unknown command '$cmd'"
    ;;
esac
