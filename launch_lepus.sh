#!/usr/bin/env bash
# ============================================================
#  LEPUS dev launcher (Git Bash / WSL / any Unix shell)
#
#  Starts the built Lepus binary via mach run, which ensures:
#    - -no-remote          (refuse to join an existing firefox.exe
#                           process, so a fresh JS module context
#                           is always loaded)
#    - -profile obj-lepus/tmp/profile-default
#                          (dev profile isolated from stock Firefox)
#    - MOZCONFIG=mozconfig.lepus
#                          (uses the Lepus build config and objdir)
#
#  Usage:
#    ./launch_lepus.sh
#    ./launch_lepus.sh --new-window https://example.com
#                                     (extra args passed to mach run)
# ============================================================

set -e

# cd to the directory this script lives in, regardless of where it
# was invoked from.
cd "$(dirname "$0")"

if [ ! -f mozconfig.lepus ]; then
  echo "[launch_lepus] ERROR: mozconfig.lepus not found in $(pwd)"
  echo "                     Are you sure this is the Lepus repo root?"
  exit 1
fi
if [ ! -f mach ]; then
  echo "[launch_lepus] ERROR: mach not found in $(pwd)"
  exit 1
fi

export MOZCONFIG=mozconfig.lepus

echo "[launch_lepus] Starting Lepus..."
echo "[launch_lepus]   repo:      $(pwd)"
echo "[launch_lepus]   MOZCONFIG: $MOZCONFIG"
echo "[launch_lepus]   args:      $*"
echo

exec ./mach run "$@"
