#!/usr/bin/env bash
# Commit every changed or untracked file under the given paths as its own commit,
# deriving a descriptive message from the path (PRD section 16: one file per commit,
# no co-author trailers). Usage: scripts/commit-auto.sh <scope> <path>...
set -euo pipefail
scope="$1"; shift

describe() {
  local f="$1" base verb="update"
  base="$(basename "$f")"
  git ls-files --error-unmatch -- "$f" >/dev/null 2>&1 || verb="add"
  case "$f" in
    *.test.ts|*.test.tsx) echo "test($scope): $verb $base" ;;
    *.css) echo "style($scope): $verb ${base%.css} styles" ;;
    *.md) echo "docs: $verb ${base%.md}" ;;
    package.json|package-lock.json|tsconfig*.json|vite.config.ts|vitest.config.ts|wrangler.toml) echo "chore($scope): $verb $base" ;;
    */public/*) echo "feat($scope): $verb static asset $base" ;;
    *) echo "feat($scope): $verb ${base%.*}" ;;
  esac
}

git ls-files --modified --others --exclude-standard -- "$@" | while IFS= read -r f; do
  [ -z "$f" ] && continue
  msg="$(describe "$f")"
  git add -- "$f"
  if git diff --cached --quiet -- "$f"; then continue; fi
  git commit --quiet -m "$msg" -- "$f"
  echo "committed: $f"
done
