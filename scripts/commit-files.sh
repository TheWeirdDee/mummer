#!/usr/bin/env bash
# Commit each file separately with its own message, as required by the PRD
# (section 16: "commit each changed file separately ... no co-author trailers").
#
# Usage: scripts/commit-files.sh "path/to/file::Commit message" "other/file::Another message"
#
# Files that are unchanged or missing are skipped with a notice. Messages are
# used verbatim; this script never appends trailers or attribution lines.
set -euo pipefail

for pair in "$@"; do
  file="${pair%%::*}"
  msg="${pair#*::}"
  if [ ! -e "$file" ]; then
    echo "skip (missing): $file"
    continue
  fi
  git add -- "$file"
  if git diff --cached --quiet -- "$file"; then
    echo "skip (no changes): $file"
    continue
  fi
  git commit --quiet -m "$msg" -- "$file"
  echo "committed: $file"
done
