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

// Playwright always uses DEFAULT_MATCH_SIMULATION_COUNT (edit here). We do not read
// UNDERCARD_MATCH_SIMULATION_COUNT when loaded as a module, because IDEs and shells often
// export it (e.g. 200) and would ignore this constant.
// CLI only: `UNDERCARD_MATCH_SIMULATION_COUNT=500 node tests/match-simulation.spec.js`
// (`npm run test:all` runs this file with no env — uses DEFAULT_MATCH_SIMULATION_COUNT.)
// Quick run: `npm run test:match-sim:quick`
const DEFAULT_MATCH_SIMULATION_COUNT = 20000;

function resolveMatchSimulationCount() {
  if (require.main !== module) {
    return DEFAULT_MATCH_SIMULATION_COUNT;
  }
  const raw = process.env.UNDERCARD_MATCH_SIMULATION_COUNT;
  if (raw === undefined || raw === "") {
    return DEFAULT_MATCH_SIMULATION_COUNT;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MATCH_SIMULATION_COUNT;
}

const MATCH_SIMULATION_COUNT = resolveMatchSimulationCount();

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

/** Every ordered pair (player role, opponent role) appears equally over seeds 0 .. n*(n-1)-1. */
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

/** Count maneuver cards (instances) still on one side at match end — hand, deck, discard, exhaust. */
function maneuverCardCountsById(player) {
  const counts = {};
  function add(list) {
    if (!Array.isArray(list)) {
      return;
    }
    for (const c of list) {
      const id = c && (c.id || c.cardId);
      if (!id) {
        continue;
      }
      counts[id] = (counts[id] || 0) + 1;
    }
  }
  add(player.hand);
  add(player.maneuverDeck);
  add(player.discardPile);
  add(player.exhaustPile);
  return counts;
}

function mergeCounts(target, delta) {
  for (const [id, n] of Object.entries(delta)) {
    target[id] = (target[id] || 0) + n;
  }
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
  const startPlayerPin = Engine.getPinfallSummary(state.players.player);
  const startEnemyPin = Engine.getPinfallSummary(state.players.enemy);

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

  const wk = state.match.winnerKey;
  const winnerPlayer = state.players[wk];
  const loserPlayer = state.players[state.match.loserKey];
  const endPlayerPin = Engine.getPinfallSummary(state.players.player);
  const endEnemyPin = Engine.getPinfallSummary(state.players.enemy);

  return {
    playerName: matchup.player.name,
    enemyName: matchup.enemy.name,
    winnerKey: wk,
    winnerName: winnerPlayer.name,
    winnerManeuverCounts: maneuverCardCountsById(winnerPlayer),
    loserManeuverCounts: maneuverCardCountsById(loserPlayer),
    reason: state.match.reason,
    turns: state.turn?.number || 0,
    playerDamage: state.players.player.damage,
    enemyDamage: state.players.enemy.damage,
    playerFail: endPlayerPin.fail,
    enemyFail: endEnemyPin.fail,
    playerKickout: endPlayerPin.kickout,
    enemyKickout: endEnemyPin.kickout,
    playerFailAccrued: endPlayerPin.fail - startPlayerPin.fail,
    enemyFailAccrued: endEnemyPin.fail - startEnemyPin.fail,
    playerKickoutAccrued: endPlayerPin.kickout - startPlayerPin.kickout,
    enemyKickoutAccrued: endEnemyPin.kickout - startEnemyPin.kickout
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

function cardLabel(id, cardLookup) {
  const c = cardLookup[id];
  return c && c.name ? `${c.name} (${id})` : id;
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
    totalPlayerKickout: 0,
    totalEnemyKickout: 0,
    totalPlayerFailAccrued: 0,
    totalEnemyFailAccrued: 0,
    totalPlayerKickoutAccrued: 0,
    totalEnemyKickoutAccrued: 0,
    maxCombinedFailAccrued: Number.NEGATIVE_INFINITY,
    minCombinedFailAccrued: Number.POSITIVE_INFINITY,
    maxCombinedKickoutAccrued: Number.NEGATIVE_INFINITY,
    minCombinedKickoutAccrued: Number.POSITIVE_INFINITY,
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
    wrestlerWins: {},
    cardCopiesOnWinSide: {},
    cardCopiesOnLoseSide: {}
  };

  for (let index = 0; index < MATCH_SIMULATION_COUNT; index += 1) {
    const result = runSingleMatch(index + 1, cardLookup);
    summary.totalTurns += result.turns;
    summary.totalPlayerDamage += result.playerDamage;
    summary.totalEnemyDamage += result.enemyDamage;
    summary.totalPlayerFail += result.playerFail;
    summary.totalEnemyFail += result.enemyFail;
    summary.totalPlayerKickout += result.playerKickout;
    summary.totalEnemyKickout += result.enemyKickout;
    summary.totalPlayerFailAccrued += result.playerFailAccrued;
    summary.totalEnemyFailAccrued += result.enemyFailAccrued;
    summary.totalPlayerKickoutAccrued += result.playerKickoutAccrued;
    summary.totalEnemyKickoutAccrued += result.enemyKickoutAccrued;

    if (result.winnerKey === "player") {
      summary.playerWins += 1;
    } else {
      summary.enemyWins += 1;
    }

    const reasonKey = result.reason || "unknown";
    summary.reasonCounts[reasonKey] = (summary.reasonCounts[reasonKey] || 0) + 1;

    const turnBucket = bucketTurns(result.turns);
    summary.turnBuckets[turnBucket] += 1;

    summary.wrestlerWins[result.winnerName] = (summary.wrestlerWins[result.winnerName] || 0) + 1;
    mergeCounts(summary.cardCopiesOnWinSide, result.winnerManeuverCounts);
    mergeCounts(summary.cardCopiesOnLoseSide, result.loserManeuverCounts);

    if (result.turns > summary.longest.turns) {
      summary.longest = { turns: result.turns, index: index + 1, reason: result.reason };
    }
    if (result.turns < summary.shortest.turns) {
      summary.shortest = { turns: result.turns, index: index + 1, reason: result.reason };
    }

    const combinedFailAccrued = result.playerFailAccrued + result.enemyFailAccrued;
    const combinedKickoutAccrued = result.playerKickoutAccrued + result.enemyKickoutAccrued;
    summary.maxCombinedFailAccrued = Math.max(summary.maxCombinedFailAccrued, combinedFailAccrued);
    summary.minCombinedFailAccrued = Math.min(summary.minCombinedFailAccrued, combinedFailAccrued);
    summary.maxCombinedKickoutAccrued = Math.max(summary.maxCombinedKickoutAccrued, combinedKickoutAccrued);
    summary.minCombinedKickoutAccrued = Math.min(summary.minCombinedKickoutAccrued, combinedKickoutAccrued);
  }

  const averageTurns = summary.totalTurns / summary.total;
  const averagePlayerDamage = summary.totalPlayerDamage / summary.total;
  const averageEnemyDamage = summary.totalEnemyDamage / summary.total;
  const averagePlayerFail = summary.totalPlayerFail / summary.total;
  const averageEnemyFail = summary.totalEnemyFail / summary.total;
  const averagePlayerKickout = summary.totalPlayerKickout / summary.total;
  const averageEnemyKickout = summary.totalEnemyKickout / summary.total;
  const averagePlayerFailAccrued = summary.totalPlayerFailAccrued / summary.total;
  const averageEnemyFailAccrued = summary.totalEnemyFailAccrued / summary.total;
  const averagePlayerKickoutAccrued = summary.totalPlayerKickoutAccrued / summary.total;
  const averageEnemyKickoutAccrued = summary.totalEnemyKickoutAccrued / summary.total;
  summary.averageCombinedFailAccrued = averagePlayerFailAccrued + averageEnemyFailAccrued;
  summary.averageCombinedKickoutAccrued = averagePlayerKickoutAccrued + averageEnemyKickoutAccrued;
  const sortedReasons = Object.entries(summary.reasonCounts).sort((a, b) => b[1] - a[1]);
  const sortedWrestlerWins = Object.entries(summary.wrestlerWins).sort((a, b) => b[1] - a[1]);

  const allCardIds = new Set([
    ...Object.keys(summary.cardCopiesOnWinSide),
    ...Object.keys(summary.cardCopiesOnLoseSide)
  ]);
  const minSamplesForRate = Math.max(80, Math.floor(summary.total / 40));
  const cardRates = [];
  for (const id of allCardIds) {
    const w = summary.cardCopiesOnWinSide[id] || 0;
    const l = summary.cardCopiesOnLoseSide[id] || 0;
    const t = w + l;
    if (t < minSamplesForRate) {
      continue;
    }
    cardRates.push({ id, w, l, t, rate: w / t });
  }
  cardRates.sort((a, b) => b.rate - a.rate);
  const topByWinShare = cardRates.slice(0, 20);
  const byRateAsc = [...cardRates].sort((a, b) => a.rate - b.rate);
  const belowCoinFlip = byRateAsc.filter((x) => x.rate < 0.5 - 1e-9);
  const bottomByWinShare = (
    belowCoinFlip.length >= 8 ? belowCoinFlip : byRateAsc
  ).slice(0, 20);

  const topByCopiesInWins = Object.entries(summary.cardCopiesOnWinSide)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25);

  console.log("");
  console.log("=== UnderCard Match Simulation ===");
  console.log(`Matches simulated: ${summary.total}`);
  console.log(`Player wins: ${summary.playerWins}`);
  console.log(`Enemy wins: ${summary.enemyWins}`);
  console.log(`Average turns per match: ${averageTurns.toFixed(2)}`);
  console.log(`Average end damage -> player: ${averagePlayerDamage.toFixed(2)}, enemy: ${averageEnemyDamage.toFixed(2)}`);
  console.log(`Average end fail cards -> player: ${averagePlayerFail.toFixed(2)}, enemy: ${averageEnemyFail.toFixed(2)}`);
  console.log(`Average end kickout cards -> player: ${averagePlayerKickout.toFixed(2)}, enemy: ${averageEnemyKickout.toFixed(2)}`);
  console.log("");
  console.log("AI vs AI pinfall accrual per match (end - start):");
  console.log(
    `  Fail accrued avg -> player: ${averagePlayerFailAccrued.toFixed(2)}, enemy: ${averageEnemyFailAccrued.toFixed(2)}, combined: ${summary.averageCombinedFailAccrued.toFixed(2)}`
  );
  console.log(
    `  Kickout accrued avg -> player: ${averagePlayerKickoutAccrued.toFixed(2)}, enemy: ${averageEnemyKickoutAccrued.toFixed(2)}, combined: ${summary.averageCombinedKickoutAccrued.toFixed(2)}`
  );
  console.log(
    `  Combined fail accrued range per match: ${summary.minCombinedFailAccrued} .. ${summary.maxCombinedFailAccrued}`
  );
  console.log(
    `  Combined kickout accrued range per match: ${summary.minCombinedKickoutAccrued} .. ${summary.maxCombinedKickoutAccrued}`
  );
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
  console.log("Wins by deck (wrestler) — who wins most often:");
  sortedWrestlerWins.forEach(([name, count]) => {
    const pct = ((count / summary.total) * 100).toFixed(1);
    console.log(`  ${name}: ${count} (${pct}%)`);
  });
  console.log("");
  console.log(
    "Maneuver card copies on winning side at match end (sum across wins — frequent = often in winning piles):"
  );
  topByCopiesInWins.forEach(([id, count]) => {
    console.log(`  ${cardLabel(id, cardLookup)}: ${count}`);
  });
  console.log("");
  console.log(
    `Win-share by card (copies on winner / copies on winner+loser at end; min ${minSamplesForRate} combined copies). Higher ≈ more often on winning side — confounded by wrestler recipes.`
  );
  console.log("  Highest win-share (sample cards):");
  topByWinShare.forEach(({ id, w, l, rate }) => {
    console.log(
      `    ${cardLabel(id, cardLookup)}: ${(rate * 100).toFixed(1)}% (${w} win / ${l} lose, n=${w + l})`
    );
  });
  console.log("  Lowest win-share (sample cards):");
  bottomByWinShare.forEach(({ id, w, l, rate }) => {
    console.log(
      `    ${cardLabel(id, cardLookup)}: ${(rate * 100).toFixed(1)}% (${w} win / ${l} lose, n=${w + l})`
    );
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

let cachedSimulationSummary = null;
function getSimulationSummary() {
  if (!cachedSimulationSummary) {
    cachedSimulationSummary = runSimulationReport();
  }
  return cachedSimulationSummary;
}

if (test && expect && require.main !== module) {
  test("simulates many matches and prints analysis log", () => {
    test.setTimeout(Math.min(900_000, Math.max(30_000, MATCH_SIMULATION_COUNT * 5 + 20_000)));
    expect(wrestlers.length).toBeGreaterThanOrEqual(2);
    const summary = getSimulationSummary();
    expect(summary.total).toBeGreaterThan(0);
  });

  test("simulates AI vs AI pinfall accrual (fail and kickout) per match", () => {
    test.setTimeout(Math.min(900_000, Math.max(30_000, MATCH_SIMULATION_COUNT * 5 + 20_000)));
    const summary = getSimulationSummary();
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.averageCombinedFailAccrued).toBeGreaterThanOrEqual(0);
    expect(summary.averageCombinedKickoutAccrued).toBeGreaterThanOrEqual(0);
    expect(summary.maxCombinedFailAccrued).toBeGreaterThanOrEqual(summary.minCombinedFailAccrued);
    expect(summary.maxCombinedKickoutAccrued).toBeGreaterThanOrEqual(summary.minCombinedKickoutAccrued);
  });
}

if (require.main === module) {
  const summary = runSimulationReport();
  if (summary.total <= 0) {
    process.exitCode = 1;
  }
}
