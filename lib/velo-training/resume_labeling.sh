#!/usr/bin/env bash
# Resume Velo hardval_gold pose labeling in Label Studio.
# Your work is saved in the Label Studio SQLite DB, not in this repo —
# this script just restarts the local server so you can keep going.
set -e
cd "$(dirname "$0")"

echo "Starting Label Studio at http://localhost:8080 ..."
echo "Open that URL -> project 'hardval_gold' -> continue labeling."
echo "(Images are embedded in the tasks, so no extra config needed.)"
echo

exec .ls-venv/bin/label-studio start --port 8080 --no-browser
