let test;
let expect;
try {
  ({ test, expect } = require("@playwright/test"));
} catch (_error) {
  test = null;
  expect = null;
}
const Engine = require("../game-engine");
const cardPool = require("../data/card-pool.json");
const deckRecipe = require("../data/deck-recipe.json");
const wrestlers = require("../data/wrestlers.json");

// Default run size (edit here). Optional override: UNDERCARD_MATCH_SIMULATION_COUNT — not
// MATCH_SIMULATION_COUNT, because that name is easy to export globally (e.g. 200) and would
// override this file every time Playwright inherits the shell environment.
const DEFAULT_MATCH_SIMULATION_COUNT = 20000;
const MATCH_SIMULATION_COUNT = Number(
  process.env.UNDERCARD_MATCH_SIMULATION_COUNT || DEFAULT_MATCH_SIMULATION_COUNT
);

function buildCardLookup(cards) {
  return Object.fromEntries(cards.map((card) => [card.id, card]));
}

function makeRandomSource(seed) {
  let value = seed % 2147483647;
  if (value <= 0) {
    value += 2147483646;
  }
  return function next() {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function cloneWrestler(wrestler) {
  return { name: wrestler.name, category: wrestler.category };
}

/** Every ordered pair (player role, opponent role) appears equally over seeds 0 .. n*(n-1)-1. Strong spread for large sim counts. */
function matchupFromSeed(seed) {
  const n = wrestlers.length;
  if (n < 2) {
    throw new Error("Need at least two wrestlers for match simulation.");
  }
  const pairCount = n * (n - 1);
  const k = ((seed % pairCount) + pairCount) % pairCount;
  const pi = Math.floor(k / (n - 1));
  const pos = k % (n - 1);
  const ei = pos < pi ? pos : pos + 1;
  return {
    player: cloneWrestler(wrestlers[pi]),
    enemy: cloneWrestler(wrestlers[ei])
  };
}

function runSingleMatch(seed, cardLookup) {
  const matchup = matchupFromSeed(seed - 1);
  const random = makeRandomSource(seed);
  const state = Engine.createMatch({
    random,
    player: {
      name: matchup.player.name,
      maneuverDeck: Engine.buildDeckForWrestler(matchup.player, cardLookup, deckRecipe),
      shuffleManeuverDeck: true
    },
    enemy: {
      name: matchup.enemy.name,
      maneuverDeck: Engine.buildDeckForWrestler(matchup.enemy, cardLookup, deckRecipe),
      shuffleManeuverDeck: true
    }
  });

  let safety = 0;
  while (!state.match.over && safety < 5000) {
    safety += 1;

    if (state.phase === Engine.PHASES.TURN_END) {
      Engine.continueAfterTurnEnd(state);
      continue;
    }

    if (state.phase === Engine.PHASES.PINFALL_DRAW) {
      Engine.drawNextPinfallCard(state);
      continue;
    }

    if (state.resolution?.awaitingDefenceChoice) {
      const defence = Engine.chooseAiDefence(state);
      if (defence.type === "none") {
        Engine.chooseNoDefence(state);
      } else {
        Engine.prepareDefence(state, defence.handIndex);
        Engine.callDefenceCoin(state);
      }
      continue;
    }

    if (state.phase === Engine.PHASES.CHOOSE_NEXT_ACTION) {
      const attackerKey = state.turn.attackerKey;
      const offence = Engine.chooseAiOffence(state, attackerKey);
      if (offence.type === "stop") {
        Engine.stopTurn(state);
      } else {
        Engine.playOffensiveCard(state, offence.handIndex, attackerKey);
      }
      continue;
    }
  }

  if (!state.match.over) {
    throw new Error("Simulation safety limit reached before match end.");
  }

  return {
    playerName: matchup.player.name,
    enemyName: matchup.enemy.name,
    winnerKey: state.match.winnerKey,
    loserKey: state.match.loserKey,
    reason: state.match.reason,
    turns: state.turn?.number || 0,
    playerDamage: state.players.player.damage,
    enemyDamage: state.players.enemy.damage,
    playerFail: Engine.getPinfallSummary(state.players.player).fail,
    enemyFail: Engine.getPinfallSummary(state.players.enemy).fail
  };
}

function bucketTurns(turns) {
  if (turns <= 10) return "01-10";
  if (turns <= 20) return "11-20";
  if (turns <= 30) return "21-30";
  if (turns <= 40) return "31-40";
  if (turns <= 50) return "41-50";
  return "51+";
}

function runSimulationReport() {
  const cardLookup = buildCardLookup(cardPool);
  const summary = {
    total: MATCH_SIMULATION_COUNT,
    playerWins: 0,
    enemyWins: 0,
    totalTurns: 0,
    totalPlayerDamage: 0,
    totalEnemyDamage: 0,
    totalPlayerFail: 0,
    totalEnemyFail: 0,
    longest: { turns: 0, index: -1, reason: "" },
    shortest: { turns: Number.POSITIVE_INFINITY, index: -1, reason: "" },
    reasonCounts: {},
    turnBuckets: {
      "01-10": 0,
      "11-20": 0,
      "21-30": 0,
      "31-40": 0,
      "41-50": 0,
      "51+": 0
    },
    matchupCounts: {},
    asPlayersWrestler: {},
    asOpponentWrestler: {}
  };

  for (let index = 0; index < MATCH_SIMULATION_COUNT; index += 1) {
    const result = runSingleMatch(index + 1, cardLookup);
    summary.totalTurns += result.turns;
    summary.totalPlayerDamage += result.playerDamage;
    summary.totalEnemyDamage += result.enemyDamage;
    summary.totalPlayerFail += result.playerFail;
    summary.totalEnemyFail += result.enemyFail;

    if (result.winnerKey === "player") {
      summary.playerWins += 1;
    } else {
      summary.enemyWins += 1;
    }

    const reasonKey = result.reason || "unknown";
    summary.reasonCounts[reasonKey] = (summary.reasonCounts[reasonKey] || 0) + 1;

    const turnBucket = bucketTurns(result.turns);
    summary.turnBuckets[turnBucket] += 1;

    const matchupKey = `${result.playerName} vs ${result.enemyName}`;
    summary.matchupCounts[matchupKey] = (summary.matchupCounts[matchupKey] || 0) + 1;
    summary.asPlayersWrestler[result.playerName] = (summary.asPlayersWrestler[result.playerName] || 0) + 1;
    summary.asOpponentWrestler[result.enemyName] = (summary.asOpponentWrestler[result.enemyName] || 0) + 1;

    if (result.turns > summary.longest.turns) {
      summary.longest = { turns: result.turns, index: index + 1, reason: result.reason };
    }
    if (result.turns < summary.shortest.turns) {
      summary.shortest = { turns: result.turns, index: index + 1, reason: result.reason };
    }
  }

  const averageTurns = summary.totalTurns / summary.total;
  const averagePlayerDamage = summary.totalPlayerDamage / summary.total;
  const averageEnemyDamage = summary.totalEnemyDamage / summary.total;
  const averagePlayerFail = summary.totalPlayerFail / summary.total;
  const averageEnemyFail = summary.totalEnemyFail / summary.total;
  const sortedReasons = Object.entries(summary.reasonCounts).sort((a, b) => b[1] - a[1]);
  const sortedMatchups = Object.entries(summary.matchupCounts).sort((a, b) => b[1] - a[1]);
  const sortedPlayersRole = wrestlers.map((w) => [w.name, summary.asPlayersWrestler[w.name] || 0]);
  const sortedOpponentRole = wrestlers.map((w) => [w.name, summary.asOpponentWrestler[w.name] || 0]);
  const roleCountsArr = wrestlers.map((w) => summary.asPlayersWrestler[w.name] || 0);
  const oppCountsArr = wrestlers.map((w) => summary.asOpponentWrestler[w.name] || 0);

  summary.spreadChecks = {
    playerRoleDelta:
      roleCountsArr.length === 0
        ? 0
        : Math.max(...roleCountsArr) - Math.min(...roleCountsArr),
    opponentRoleDelta:
      oppCountsArr.length === 0
        ? 0
        : Math.max(...oppCountsArr) - Math.min(...oppCountsArr)
  };

  console.log("");
  console.log("=== UnderCard Match Simulation ===");
  console.log(`Matches simulated: ${summary.total}`);
  console.log(`Player wins: ${summary.playerWins}`);
  console.log(`Enemy wins: ${summary.enemyWins}`);
  console.log(`Average turns per match: ${averageTurns.toFixed(2)}`);
  console.log(`Average end damage -> player: ${averagePlayerDamage.toFixed(2)}, enemy: ${averageEnemyDamage.toFixed(2)}`);
  console.log(`Average end fail cards -> player: ${averagePlayerFail.toFixed(2)}, enemy: ${averageEnemyFail.toFixed(2)}`);
  console.log("");
  console.log("Turn length buckets:");
  Object.entries(summary.turnBuckets).forEach(([bucket, count]) => {
    const pct = ((count / summary.total) * 100).toFixed(1);
    console.log(`  ${bucket}: ${count} (${pct}%)`);
  });
  console.log("");
  console.log("Top finish reasons:");
  sortedReasons.slice(0, 5).forEach(([reason, count]) => {
    const pct = ((count / summary.total) * 100).toFixed(1);
    console.log(`  ${count} (${pct}%): ${reason}`);
  });
  console.log("");
  console.log(
    `Wrestler as PLAYER's deck (target ~${(summary.total / wrestlers.length).toFixed(1)} each; matchups cycle all ${wrestlers.length * (wrestlers.length - 1)} ordered pairs):`
  );
  sortedPlayersRole.forEach(([name, count]) => {
    const pct = ((count / summary.total) * 100).toFixed(1);
    console.log(`  ${name}: ${count} (${pct}%)`);
  });
  console.log(
    `  Spread (max − min appearances as player deck): ${summary.spreadChecks.playerRoleDelta}`
  );
  console.log("");
  console.log("Wrestler as OPPONENT's deck:");
  sortedOpponentRole.forEach(([name, count]) => {
    const pct = ((count / summary.total) * 100).toFixed(1);
    console.log(`  ${name}: ${count} (${pct}%)`);
  });
  console.log(
    `  Spread (max − min appearances as opponent deck): ${summary.spreadChecks.opponentRoleDelta}`
  );
  console.log("");
  console.log("Matchup coverage (player vs opp pair counts):");
  sortedMatchups.forEach(([matchup, count]) => {
    console.log(`  ${matchup}: ${count}`);
  });
  console.log("");
  console.log(
    `Longest match: #${summary.longest.index} (${summary.longest.turns} turns) - ${summary.longest.reason}`
  );
  console.log(
    `Shortest match: #${summary.shortest.index} (${summary.shortest.turns} turns) - ${summary.shortest.reason}`
  );
  console.log("===============================");
  console.log("");
  return summary;
}

if (test && expect && require.main !== module) {
  test("simulates many matches and prints analysis log", () => {
    test.setTimeout(Math.min(900_000, Math.max(30_000, MATCH_SIMULATION_COUNT * 5 + 20_000)));
    expect(wrestlers.length).toBeGreaterThanOrEqual(2);
    const summary = runSimulationReport();
    expect(summary.total).toBeGreaterThan(0);

    const n = wrestlers.length;
    const pairCount = n * (n - 1);
    const byName = summary.total / n;
    if (summary.total >= pairCount) {
      wrestlers.forEach((w) => {
        expect(summary.asPlayersWrestler[w.name] || 0).toBeGreaterThan(0);
        expect(summary.asOpponentWrestler[w.name] || 0).toBeGreaterThan(0);
      });
      const remainder = summary.total % pairCount;
      const partialSlack = remainder === 0 ? 0 : n - 1;
      const spreadTolerance = Math.max(2, Math.ceil(byName / 20), partialSlack);
      expect(summary.spreadChecks.playerRoleDelta).toBeLessThanOrEqual(spreadTolerance);
      expect(summary.spreadChecks.opponentRoleDelta).toBeLessThanOrEqual(spreadTolerance);
    }
  });
}

if (require.main === module) {
  const summary = runSimulationReport();
  if (summary.total <= 0) {
    process.exitCode = 1;
  }
}
