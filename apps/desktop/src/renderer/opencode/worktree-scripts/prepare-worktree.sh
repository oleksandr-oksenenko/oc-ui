#!/bin/sh

set -f
# Encode fields so paths and Git diagnostics can contain whitespace or newlines.
hex() {
  printf '%s' "$1" | od -An -tx1 -v | tr -d ' \n'
}

# Fixed fields: destination (hex), commit, diagnostic (hex).
result() {
  printf '\nOCUI1\t%s\t%s\t%s\n' "$(hex "$parent")" "$1" "$(hex "$2")"
}

parent=
case "${XDG_DATA_HOME-}" in
  /*) parent="$XDG_DATA_HOME/opencode/worktree" ;;
esac
if [ -z "$parent" ]; then
  case "${HOME-}" in
    /*) parent="$HOME/.local/share/opencode/worktree" ;;
  esac
fi
if [ -z "$parent" ]; then
  result "" 'The server has no absolute XDG_DATA_HOME or HOME.'
  exit 1
fi

local_main=$(git rev-parse --verify 'refs/heads/main^{commit}' 2>/dev/null) || {
  result "" 'The project has no local main branch.'
  exit 1
}

# Publish local main before fetching so a confirmed timeout can use it.
result "$local_main" ""

fail() {
  result "$local_main" "${1:-Origin discovery or fetch failed.}"
  exit 0
}

remote_output=$(git ls-remote --symref origin HEAD 2>&1) || fail "$remote_output"

symref=$(printf '%s\n' "$remote_output" | awk '$1 == "ref:" && $3 == "HEAD" { print $2; exit }')
case "$symref" in
  refs/heads/*) branch=${symref#refs/heads/} ;;
  *) fail "The origin HEAD response did not contain a valid branch ref." ;;
esac
if [ -z "$branch" ] || ! git check-ref-format "refs/heads/${branch}" >/dev/null 2>&1; then
  fail "The origin HEAD response contained an invalid branch ref."
fi

fetch_output=$(git fetch --no-tags origin "+refs/heads/${branch}:refs/remotes/origin/${branch}" 2>&1) ||
  fail "$fetch_output"

# Refresh the remote default-branch hint independently of the local base.
git symbolic-ref refs/remotes/origin/HEAD "refs/remotes/origin/${branch}" >/dev/null 2>&1 || :

# Capture the latest local main after fetching; never use a remote ref as the base.
commit=$(git rev-parse --verify 'refs/heads/main^{commit}' 2>/dev/null) || {
  result "" 'The project has no local main branch.'
  exit 0
}
result "$commit" ""
