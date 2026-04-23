pnpm -C packages/game-server exec tsx scripts/test-harness/combat-e2e.ts "--scenario=bard/cutting-words-control" 2>&1 | Select-Object -Last 200
