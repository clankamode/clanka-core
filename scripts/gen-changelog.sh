#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "gen-changelog.sh requires a git repository" >&2
  exit 1
fi

feat_lines=""
fix_lines=""
chore_lines=""
test_lines=""
other_lines=""

append_line() {
  local bucket="$1"
  local value="$2"
  case "$bucket" in
    feat) feat_lines+="${value}"$'\n' ;;
    fix) fix_lines+="${value}"$'\n' ;;
    chore) chore_lines+="${value}"$'\n' ;;
    test) test_lines+="${value}"$'\n' ;;
    other) other_lines+="${value}"$'\n' ;;
    *)
      echo "gen-changelog.sh: unknown bucket: ${bucket}" >&2
      exit 1
      ;;
  esac
}

print_section() {
  local title="$1"
  local content="$2"
  echo "## ${title}"
  if [[ -n "$content" ]]; then
    printf '%s' "$content"
  else
    echo "- _none_"
  fi
  echo
}

entry_count=0
while IFS= read -r entry; do
  [[ -z "$entry" ]] && continue
  entry_count=$((entry_count + 1))
  sha="${entry%% *}"
  msg="${entry#* }"
  line="- \`${sha}\` ${msg}"

  if [[ "$msg" == feat:* || "$msg" == feat\(*\):* ]]; then
    append_line feat "$line"
  elif [[ "$msg" == fix:* || "$msg" == fix\(*\):* ]]; then
    append_line fix "$line"
  elif [[ "$msg" == chore:* || "$msg" == chore\(*\):* ]]; then
    append_line chore "$line"
  elif [[ "$msg" == test:* || "$msg" == test\(*\):* ]]; then
    append_line test "$line"
  else
    append_line other "$line"
  fi
done < <(git log --oneline --no-merges -n 20)

if [[ "$entry_count" -eq 0 ]]; then
  echo "gen-changelog.sh: no commits found to summarize" >&2
  exit 1
fi

{
  echo "# Changelog"
  echo
  echo "_Generated from \`git log --oneline --no-merges\` (latest ${entry_count} entries)._"
  echo
  print_section "Features" "$feat_lines"
  print_section "Fixes" "$fix_lines"
  print_section "Chores" "$chore_lines"
  print_section "Tests" "$test_lines"
  print_section "Other" "$other_lines"
} > CHANGELOG.md

echo "Wrote CHANGELOG.md (${entry_count} commits)"
