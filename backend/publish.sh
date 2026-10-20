#!/usr/bin/env bash
# Runs inside the Ledger GitHub Action: fold relay events → update the spreadsheet → commit to main.
# Always starts from the newest main, so a push that races with another commit is simply redone.
set -euo pipefail

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
summary="$(mktemp)"

for attempt in 1 2 3 4; do
  git fetch --quiet origin main
  git reset --quiet --hard origin/main
  node backend/fold.mjs --summary-file "$summary"
  if [ -z "$(git status --porcelain -- data)" ]; then
    exit 0
  fi
  python -m pip install --quiet --disable-pip-version-check openpyxl==3.1.5
  python backend/sheet.py
  git add data step-tracking_Team8.xlsx
  git commit --quiet -F "$summary"
  if git push --quiet origin HEAD:main; then
    echo "Pushed: $(head -n1 "$summary")"
    exit 0
  fi
  echo "main moved while folding — retrying ($attempt)"
  sleep $((attempt * 3))
done
echo "::error::Could not push the ledger after 4 attempts"
exit 1
