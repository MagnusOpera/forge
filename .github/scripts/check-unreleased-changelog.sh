#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT_DIR"

BASE_REF="${GITHUB_BASE_REF:-}"
REQUIRE_CHANGELOG_ALWAYS="${REQUIRE_CHANGELOG_ALWAYS:-false}"
ENFORCE_UNRELEASED_BULLET="${ENFORCE_UNRELEASED_BULLET:-false}"

if [[ -n "$BASE_REF" ]]; then
  git fetch --no-tags --depth=1 origin "$BASE_REF" >/dev/null 2>&1 || true
  mapfile -t CHANGED_FILES < <(git diff --name-only "origin/${BASE_REF}...HEAD")
else
  mapfile -t CHANGED_FILES < <(
    {
      git diff --name-only HEAD
      git ls-files --others --exclude-standard
    } | sort -u
  )

  if [[ ${#CHANGED_FILES[@]} -eq 0 ]]; then
    if git rev-parse --verify HEAD~1 >/dev/null 2>&1; then
      mapfile -t CHANGED_FILES < <(git diff --name-only HEAD~1...HEAD)
    else
      echo "No comparable git range available; skipping changelog check."
      exit 0
    fi
  fi
fi

if [[ ${#CHANGED_FILES[@]} -eq 0 ]]; then
  echo "No changed files detected; skipping changelog check."
  exit 0
fi

if ! printf '%s\n' "${CHANGED_FILES[@]}" | grep -qx 'CHANGELOG.md'; then
  if [[ "$REQUIRE_CHANGELOG_ALWAYS" == "true" ]]; then
    echo "ERROR: CHANGELOG.md must be updated in every commit."
    exit 1
  fi

  TRIGGERS=(
    '^src/'
    '^electron/'
    '^shared/'
    '^assets/'
    '^build/'
    '^package(-lock)?\.json$'
  )

  EXEMPTS=(
    '^\.github/'
    '^Makefile$'
    '^README\.md$'
    '^CHANGELOG\.md$'
    '^\.gitignore$'
  )

  needs_changelog=false
  for file in "${CHANGED_FILES[@]}"; do
    is_trigger=false
    for pat in "${TRIGGERS[@]}"; do
      if [[ "$file" =~ $pat ]]; then
        is_trigger=true
        break
      fi
    done

    if [[ "$is_trigger" == false ]]; then
      continue
    fi

    is_exempt=false
    for pat in "${EXEMPTS[@]}"; do
      if [[ "$file" =~ $pat ]]; then
        is_exempt=true
        break
      fi
    done

    if [[ "$is_exempt" == false ]]; then
      needs_changelog=true
      break
    fi
  done

  if [[ "$needs_changelog" == true ]]; then
    echo "ERROR: Functional changes detected but CHANGELOG.md was not updated."
    echo "Add a short one-line bullet under ## [Unreleased]."
    exit 1
  fi

  echo "No changelog-required files changed."
  exit 0
fi

if ! grep -q '^## \[Unreleased\]' CHANGELOG.md; then
  echo "ERROR: CHANGELOG.md must contain a top-level '## [Unreleased]' section."
  exit 1
fi

UNRELEASED_BLOCK=$(awk '
  /^## \[Unreleased\]/{in_block=1; next}
  /^## \[/{if(in_block){exit}}
  in_block{print}
' CHANGELOG.md)

if [[ -z "${UNRELEASED_BLOCK//$'\n'/}" ]]; then
  HEAD_SUBJECT="$(git log -1 --pretty=%s)"
  if [[ "$HEAD_SUBJECT" =~ ^chore\(release\):\ [0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Changelog gate passed (release commit allows empty ## [Unreleased])."
    exit 0
  fi
  echo "ERROR: ## [Unreleased] section is empty."
  exit 1
fi

if [[ "$ENFORCE_UNRELEASED_BULLET" == "true" ]]; then
  if ! printf '%s\n' "$UNRELEASED_BLOCK" | grep -qE '^- '; then
    echo "ERROR: ## [Unreleased] must contain at least one bullet line starting with '- '."
    exit 1
  fi
fi

echo "Changelog gate passed."
