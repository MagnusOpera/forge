#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <version>"
  exit 2
fi

version="$1"
plain_version="${version#v}"

if [[ ! -f CHANGELOG.md ]]; then
  echo "ERROR: CHANGELOG.md not found."
  exit 1
fi

extract_section() {
  local header="$1"
  awk -v header="$header" '
    BEGIN { in_section = 0 }
    $0 == header { in_section = 1; next }
    /^## \[/ && in_section { exit }
    in_section { print }
  ' CHANGELOG.md
}

section_header="## [${version}]"
section_body="$(extract_section "$section_header")"

if [[ -z "${section_body//[[:space:]]/}" && "$plain_version" != "$version" ]]; then
  section_header="## [${plain_version}]"
  section_body="$(extract_section "$section_header")"
fi

if [[ -z "${section_body//[[:space:]]/}" ]]; then
  echo "ERROR: Missing or empty changelog section for '${version}'."
  echo "Add a '## [${version}]' or '## [${plain_version}]' section to CHANGELOG.md before tagging."
  exit 1
fi

if ! grep -q '^[[:space:]]*-\s\+' <<<"$section_body"; then
  echo "ERROR: Section '${section_header}' must include at least one bullet line."
  exit 1
fi

if ! grep -q '\*\*Full Changelog\*\*:' <<<"$section_body"; then
  echo "ERROR: Section '${section_header}' must include a '**Full Changelog**' compare link."
  exit 1
fi

printf '%s\n' "$section_body"
