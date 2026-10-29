#!/bin/sh
# usage: dtest.sh <lane: plain|san> <file> <pattern>   (STATS=1: runtime stats flavor, lines to ~/perf-p1/stats-*.jsonl)
W=/home/vitalii/scriptc/.claude/worktrees/agent-a85f0c88bb683b352
LANE=$1; FILE=$2; PAT=$3
EXTRA=""
[ "$LANE" = san ] && EXTRA="-e SCRIPTC_SAN=1"
[ -n "$STATS" ] && EXTRA="$EXTRA -e SCRIPTC_RUNTIME_STATS=1 -e SCR_STATS_FILE=/home/vitalii/perf-p1/stats-$STATS.jsonl"
exec docker run --rm --network none -u 1000:1000 -v $W:$W -v /home/vitalii/perf-p1:/home/vitalii/perf-p1 -w $W -e HOME=/tmp/h -e SCRIPTC_TEST_WORKERS=4 -e PAT="$PAT" -e FILE="$FILE" $EXTRA --tmpfs /tmp/h:exec,mode=1777 scriptc-legacy-validation:local sh -c 'cd '$W' && if [ -n "$PAT" ]; then npx vitest run "$FILE" -t "$PAT"; else npx vitest run "$FILE"; fi'
