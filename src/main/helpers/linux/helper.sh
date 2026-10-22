#!/bin/sh
# WhipZap Linux X11 helper (xdotool). POSIX sh, requires xdotool on PATH and an X11 session.
# UNVERIFIED-ON-HARDWARE: run docs/TESTING.md section 6.3 on a Linux X11 desktop before trusting it.
#
# Usage: /bin/sh helper.sh <command> [args]     text (for `type`) arrives on STDIN as UTF-8.
#   check                 -> {"ok":true}, code 4 on Wayland or when xdotool is missing
#   foreground            -> {"ok":true,"id":"<xid>","title":"...","processName":"...","pid":N}
#   info <xid>            -> same shape, code 3 if the window is gone
#   focus <xid>           -> {"ok":true} once the window is active, code 5 otherwise
#   type <xid> [--enter]  -> verifies <xid> is the active window (else code 3), types stdin, Enter with --enter
# Output: exactly one JSON object on stdout. Exit code = error code on failure.
# Codes: 1 other, 2 permission, 3 target gone, 4 unsupported, 5 focus failed.
#
# Safety (D-1): only `xdotool type` for the message text and `xdotool key Return` for Enter are used.
# Nothing else is ever sent. Wayland is refused up front because xdotool cannot type there.
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

check_env() {
  if [ "${XDG_SESSION_TYPE:-}" = "wayland" ] || { [ -n "${WAYLAND_DISPLAY:-}" ] && [ -z "${DISPLAY:-}" ]; }; then
    fail 4 "Wayland is not supported"
  fi
  command -v xdotool >/dev/null 2>&1 || fail 4 "xdotool not found"
  [ -n "${DISPLAY:-}" ] || fail 4 "DISPLAY is not set (no X11 session)"
}

active_window() {
  xdotool getactivewindow 2>/dev/null
}

describe() {
  id=$1
  title=$(xdotool getwindowname "$id" 2>/dev/null) || fail 3 "window $id is gone"
  pid=$(xdotool getwindowpid "$id" 2>/dev/null || true)
  comm=""
  if [ -n "$pid" ] && [ -r "/proc/$pid/comm" ]; then
    comm=$(cat "/proc/$pid/comm" 2>/dev/null || true)
  fi
  printf '{"ok":true,"id":"%s","title":"%s","processName":"%s","pid":%s}\n' \
    "$id" "$(json_str "$title")" "$(json_str "$comm")" "${pid:-0}"
}

cmd=${1:-}
case "$cmd" in
  check)
    check_env
    printf '{"ok":true}\n'
    ;;
  foreground)
    check_env
    id=$(active_window) || fail 3 "no active window"
    [ -n "$id" ] || fail 3 "no active window"
    describe "$id"
    ;;
  info)
    check_env
    [ -n "${2:-}" ] || fail 3 "missing window id"
    describe "$2"
    ;;
  focus)
    check_env
    id=${2:-}
    [ -n "$id" ] || fail 3 "missing window id"
    xdotool getwindowname "$id" >/dev/null 2>&1 || fail 3 "window $id is gone"
    xdotool windowactivate --sync "$id" >/dev/null 2>&1 || true
    i=0
    while [ "$i" -lt 5 ]; do
      [ "$(active_window)" = "$id" ] && { printf '{"ok":true}\n'; exit 0; }
      sleep 0.05
      i=$((i + 1))
    done
    fail 5 "window $id did not become active"
    ;;
  type)
    check_env
    id=${2:-}
    [ -n "$id" ] || fail 3 "missing window id"
    enter=0
    [ "${3:-}" = "--enter" ] && enter=1
    text=$(cat)
    [ "$(active_window)" = "$id" ] || fail 3 "target window $id is not active"
    if xdotool type --help 2>&1 | grep -q -- '--file'; then
      printf '%s' "$text" | xdotool type --clearmodifiers --delay 8 --file - || fail 1 "xdotool type failed"
    else
      # Single argv element; this script never re-parses it through a shell.
      xdotool type --clearmodifiers --delay 8 -- "$text" || fail 1 "xdotool type failed"
    fi
    if [ "$enter" -eq 1 ]; then
      xdotool key --clearmodifiers Return || fail 1 "xdotool key Return failed"
    fi
    printf '{"ok":true,"typed":%d}\n' "${#text}"
    ;;
  *)
    fail 4 "unknown command '$cmd'"
    ;;
esac
