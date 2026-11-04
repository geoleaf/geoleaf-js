#!/usr/bin/env bash
# Run a command through the workstation's suite queue; run it directly elsewhere.
FT="$HOME/dev/outils/navigateur/bin/file-tests"
if [ -x "$FT" ]; then exec "$FT" "$@"; fi
exec "$@"
