#!/usr/bin/env bash
# Runs inside the Ledger GitHub Action: fold relay events → keep stories media → update the spreadsheet → commit to main.
# Always starts from the newest main, so a push that races with another commit is simply redone.
set -euo pipefail

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
summary="$(mktemp)"
listing="$(mktemp)"
SDIR="${RUNNER_TEMP:-/tmp}/t8-stories"
EMPTY_TREE='4b825dc642cb6eb9a060e54bf8d69288fbee4904'

# Stories media lives on the `stories` branch, rewritten as one fresh commit whenever it changes:
# expired photos and videos leave no history behind. data.json only points at files that are already pushed.
stories() {
  local base="$EMPTY_TREE" remote=0 tree commit
  local gd; gd="$(git rev-parse --absolute-git-dir)" || return 1
  # the branch is handled in its own folder + index, leaving main's checkout untouched
  sg() { GIT_INDEX_FILE="$SDIR.index" git -C "$SDIR" --git-dir="$gd" --work-tree=. "$@"; }
  git ls-remote --exit-code --heads origin stories >/dev/null || remote=$?
  if [ "$remote" = 0 ]; then
    git fetch --quiet origin +refs/heads/stories:refs/remotes/origin/stories || return 1
    base="$(git rev-parse 'origin/stories^{tree}')" || return 1
  elif [ "$remote" != 2 ]; then
    return 1 # GitHub unreachable: never rebuild the branch from scratch
  fi
  rm -rf "$SDIR" "$SDIR.index"
  mkdir -p "$SDIR"
  if [ "$base" = "$EMPTY_TREE" ]; then sg read-tree --empty || return 1; else sg read-tree "$base" || return 1; fi
  sg checkout-index --all --force || return 1
  node backend/stories.mjs --dir "$SDIR" || return 1
  sg add --all || return 1
  tree="$(sg write-tree)" || return 1
  if [ "$tree" != "$base" ]; then
    commit="$(git commit-tree "$tree" -m "stories: $(sg ls-files | wc -l | tr -d ' ') live file(s)")" || return 1
    if git push --quiet --force origin "$commit:refs/heads/stories"; then
      sg ls-files > "$listing"
    else
      echo "::warning::Could not push the stories branch — trying again next run"
      git ls-tree --name-only "$base" > "$listing"
    fi
  else
    sg ls-files > "$listing"
  fi
  node backend/stories.mjs --mark "$listing"
}

for attempt in 1 2 3 4; do
  git fetch --quiet origin main
  git reset --quiet --hard origin/main
  node backend/fold.mjs --summary-file "$summary"
  stories || echo "::warning::Stories media step failed — steps are folded anyway"
  if [ -z "$(git status --porcelain -- data)" ]; then
    exit 0
  fi
  [ -s "$summary" ] || echo 'data: stories media' > "$summary"
  python -m pip install --quiet --disable-pip-version-check openpyxl==3.1.5
  python backend/sheet.py
  git add data step-tracking_Team8.xlsx
  git commit --quiet -F "$summary"
  if git push --quiet origin HEAD:main; then
    echo "Pushed: $(head -n1 "$summary")"
    exit 0
  fi
  echo "main moved while folding — retrying ($attempt)"
  : > "$summary"
  sleep $((attempt * 3))
done
echo "::error::Could not push the ledger after 4 attempts"
exit 1
