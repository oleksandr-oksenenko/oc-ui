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

cached=
cached_ref=$(git symbolic-ref -q refs/remotes/origin/HEAD 2>/dev/null) || cached_ref=
case "$cached_ref" in
  refs/remotes/origin/*)
    cached=$(git rev-parse --verify "$cached_ref^{commit}" 2>/dev/null) || cached=
    case "$cached" in
      ''|*[!0123456789abcdefABCDEF]*) cached= ;;
    esac
    if [ -n "$cached" ] && [ "${#cached}" -lt 40 ]; then
      cached=
    fi
    ;;
esac

# Publish the cached commit before fetching so a confirmed timeout can use it.
result "$cached" ""

fail() {
  result "$cached" "${1:-Origin discovery or fetch failed.}"
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

commit=$(git rev-parse --verify "refs/remotes/origin/${branch}^{commit}" 2>&1) || fail "$commit"

case "$commit" in
  ''|*[!0123456789abcdefABCDEF]*)
    fail "The fetched origin branch did not resolve to an immutable commit."
    ;;
esac
if [ "${#commit}" -lt 40 ]; then
  fail "The fetched origin branch did not resolve to an immutable commit."
fi

# Refresh the local default-branch hint; failure does not invalidate the fetched commit.
git symbolic-ref refs/remotes/origin/HEAD "refs/remotes/origin/${branch}" >/dev/null 2>&1 || :

result "$commit" ""
