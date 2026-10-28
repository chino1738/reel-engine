#!/bin/zsh
# Nightly reel: launchd runs this at 8:30pm. If the Mac was asleep, it runs on wake.
export PATH="/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$HOME/projects/reel-engine" || exit 1
mkdir -p logs
TODAY=$(date +%Y-%m-%d)
# one reel per night, even if launchd fires again after a wake
MARK="logs/done-$TODAY"
[ -f "$MARK" ] && { echo "$(date) already made tonight" >> logs/nightly.log; exit 0; }
caffeinate -i npm run reel -- --auto --deliver >> logs/nightly.log 2>&1
STATUS=$?
echo "$(date) exit $STATUS" >> logs/nightly.log
[ $STATUS -eq 0 ] && touch "$MARK"
