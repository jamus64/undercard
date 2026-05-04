const { test, expect } = require("@playwright/test");
const Engine = require("../game-engine");
const cardPool = require("../data/card-pool.json");
const deckRecipe = require("../data/deck-recipe.json");
const wrestlers = require("../data/wrestlers.json");

// Global simulation size. Increase/decrease this for analysis runs.
const MATCH_SIMULATION_COUNT = 2000;

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
  return { name: wrestler.name };
}

function createRandomMatch(random) {
  const playerIndex = Math.floor(random() * wrestlers.length);
  let enemyIndex = Math.floor(random() * wrestlers.length);
  if (enemyIndex === playerIndex && wrestlers.length > 1) {
    enemyIndex = (enemyIndex + 1) % wrestlers.length;
  }

  return {
    player: cloneWrestler(wrestlers[playerIndex]),
    enemy: cloneWrestler(wrestlers[enemyIndex])
  };
}

function runSingleMatch(seed, cardLookup) {
  const random = makeRandomSource(seed);
  const matchup = createRandomMatch(random);
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

test("simulates many matches and prints analysis log", () => {
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
    matchupCounts: {}
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
  console.log("Matchup coverage:");
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

  expect(summary.total).toBeGreaterThan(0);
});
