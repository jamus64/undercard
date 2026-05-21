/**
 * Deck Proportion Sweep
 *
 * One side of every match uses a fixed BASELINE proportion split (the
 * "control"). The other side uses each challenger proportion in turn. Sides
 * alternate so the initiative bonus does not favour either composition.
 * Both sides use the same wrestler/preset every match so the wrestler/
 * preset effects also cancel out — what's left is the proportion split.
 *
 * Run:
 *   node tests/deck-proportion-sweep.js
 *   UNDERCARD_SWEEP_MATCHES=5000 node tests/deck-proportion-sweep.js
 *   UNDERCARD_SWEEP_BASELINE='{"attack":26,"taunt":12,"pin":4,"dodge":4,"reversal":4}' \
 *     node tests/deck-proportion-sweep.js
 *   UNDERCARD_SWEEP_CONFIGS='[{"label":"more attacks","proportions":{"attack":32,"taunt":8,"pin":4,"dodge":3,"reversal":3}}]' \
 *     node tests/deck-proportion-sweep.js
 *
 * Notes:
 *  - Each proportion split must total 50 and respect rarity caps.
 *  - pin/dodge/reversal are common (cap = 4 copies).
 *  - Each preset's per-card distribution is scaled toward the requested type
 *    totals (largest-remainder rounding) so per-card flavour ratios survive.
 */

const Engine = require("../game-engine");
const cardPool = require("../data/card-pool.json");
const deckRecipe = require("../data/deck-recipe.json");
const deckPresets = require("../data/deck-presets.json");
const wrestlers = require("../data/wrestlers.json");

const cardLookup = Object.fromEntries(cardPool.map((card) => [card.id, card]));
const RARITY_LIMIT = { common: 4, uncommon: 3, rare: 2, special: 2 };
const TYPE_KEYS = ["attack", "taunt", "pin", "dodge", "reversal"];

const DEFAULT_BASELINE = Object.freeze({ attack: 26, taunt: 12, pin: 4, dodge: 4, reversal: 4 });

const DEFAULT_SWEEP_CONFIGS = [
  { label: "baseline (sanity)", proportions: { attack: 26, taunt: 12, pin: 4, dodge: 4, reversal: 4 } },
  { label: "attack heavy", proportions: { attack: 32, taunt: 8, pin: 4, dodge: 3, reversal: 3 } },
  { label: "attack lighter", proportions: { attack: 22, taunt: 16, pin: 4, dodge: 4, reversal: 4 } },
  { label: "taunt heavy", proportions: { attack: 22, taunt: 20, pin: 4, dodge: 2, reversal: 2 } },
  { label: "no taunts", proportions: { attack: 38, taunt: 0, pin: 4, dodge: 4, reversal: 4 } },
  { label: "min defense", proportions: { attack: 34, taunt: 8, pin: 4, dodge: 2, reversal: 2 } },
  { label: "defense heavy", proportions: { attack: 24, taunt: 14, pin: 4, dodge: 4, reversal: 4 } },
  { label: "fewer pins (2)", proportions: { attack: 30, taunt: 12, pin: 2, dodge: 3, reversal: 3 } },
  { label: "fewer pins (1)", proportions: { attack: 31, taunt: 12, pin: 1, dodge: 3, reversal: 3 } },
  { label: "no pins (0)", proportions: { attack: 32, taunt: 12, pin: 0, dodge: 3, reversal: 3 } }
];

const DEFAULT_MATCHES_PER_CONFIG = Number(process.env.UNDERCARD_SWEEP_MATCHES || 2000);

function parseConfigsFromEnv() {
  const raw = process.env.UNDERCARD_SWEEP_CONFIGS;
  if (!raw) return DEFAULT_SWEEP_CONFIGS;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`UNDERCARD_SWEEP_CONFIGS is not valid JSON: ${error.message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("UNDERCARD_SWEEP_CONFIGS must be a non-empty JSON array.");
  }
  return parsed;
}

function parseBaselineFromEnv() {
  const raw = process.env.UNDERCARD_SWEEP_BASELINE;
  if (!raw) return DEFAULT_BASELINE;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`UNDERCARD_SWEEP_BASELINE is not valid JSON: ${error.message}`);
  }
}

function validateProportions(label, proportions) {
  if (!proportions || typeof proportions !== "object") {
    throw new Error(`${label} must be an object of {type: count}.`);
  }
  for (const key of TYPE_KEYS) {
    const value = Number(proportions[key]);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${label} has invalid ${key} count "${proportions[key]}".`);
    }
  }
  const total = TYPE_KEYS.reduce((sum, key) => sum + Number(proportions[key] || 0), 0);
  if (total !== 50) {
    throw new Error(`${label} must total 50 cards, got ${total}.`);
  }
  for (const key of ["pin", "dodge", "reversal"]) {
    if (proportions[key] > RARITY_LIMIT.common) {
      throw new Error(`${label} sets ${key}=${proportions[key]} but ${key} is common (max ${RARITY_LIMIT.common}).`);
    }
  }
}

function makeRandomSource(seed) {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return function next() {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function cloneWrestler(wrestler) {
  return {
    name: wrestler.name,
    category: wrestler.category,
    deckPreset: wrestler.deckPreset,
    deckRecipe: wrestler.deckRecipe,
    archetypeName: wrestler.archetypeName
  };
}

function partitionRecipeByType(recipe) {
  const byType = { attack: [], taunt: [], pin: [], dodge: [], reversal: [] };
  for (const entry of recipe) {
    if (!entry.cardId) continue;
    const card = cardLookup[entry.cardId];
    if (!card || !byType[card.type]) continue;
    byType[card.type].push({ cardId: entry.cardId, count: entry.count });
  }
  return byType;
}

/**
 * Scale a list of same-type entries toward `target`, respecting rarity caps.
 * Uses largest-remainder rounding. If more cards are needed than the existing
 * entries can hold, pulls same-type cards from the pool, preferring the
 * wrestler's category for attacks.
 */
function scaleEntriesToTarget(entries, target, type, wrestlerCategory) {
  if (target <= 0) return [];

  const currentTotal = entries.reduce((sum, entry) => sum + entry.count, 0);
  let result = [];

  if (currentTotal > 0) {
    const scaled = entries.map((entry) => ({
      cardId: entry.cardId,
      ideal: (entry.count / currentTotal) * target
    }));
    result = scaled.map((s) => ({
      cardId: s.cardId,
      count: Math.floor(s.ideal),
      remainder: s.ideal - Math.floor(s.ideal)
    }));

    result.sort((a, b) => b.remainder - a.remainder);
    let diff = target - result.reduce((sum, entry) => sum + entry.count, 0);
    let idx = 0;
    let safety = 0;
    while (diff > 0 && safety < 5000) {
      const entry = result[idx % result.length];
      const limit = RARITY_LIMIT[cardLookup[entry.cardId].rarity] || 1;
      if (entry.count < limit) {
        entry.count += 1;
        diff -= 1;
      }
      idx += 1;
      safety += 1;
      const allFull = result.every(
        (r) => r.count >= (RARITY_LIMIT[cardLookup[r.cardId].rarity] || 1)
      );
      if (allFull) break;
    }
  }

  let diff = target - result.reduce((sum, entry) => sum + entry.count, 0);
  if (diff > 0) {
    const present = new Set(result.map((r) => r.cardId));
    const sameType = cardPool.filter((card) => card.type === type && !present.has(card.id));
    const cat = String(wrestlerCategory || "").toLowerCase();
    sameType.sort((a, b) => {
      const aMatch = String(a.category || "").toLowerCase() === cat ? 0 : 1;
      const bMatch = String(b.category || "").toLowerCase() === cat ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      return String(a.id).localeCompare(String(b.id));
    });
    for (const card of sameType) {
      if (diff <= 0) break;
      const limit = RARITY_LIMIT[card.rarity] || 1;
      const add = Math.min(limit, diff);
      result.push({ cardId: card.id, count: add, remainder: 0 });
      diff -= add;
    }
  }

  while (diff < 0) {
    result.sort((a, b) => b.count - a.count);
    if (!result.length || result[0].count <= 0) break;
    result[0].count -= 1;
    diff += 1;
  }

  return result.filter((entry) => entry.count > 0).map((entry) => ({ cardId: entry.cardId, count: entry.count }));
}

function rebuildRecipeWithProportions(recipe, target, wrestler) {
  const byType = partitionRecipeByType(recipe);
  const out = [];

  for (const type of ["attack", "taunt"]) {
    const built = scaleEntriesToTarget(byType[type], target[type], type, wrestler?.category);
    built.forEach((entry) => out.push(entry));
  }
  for (const type of ["pin", "dodge", "reversal"]) {
    if (target[type] > 0) {
      out.push({ cardId: type, count: target[type] });
    }
  }

  const total = out.reduce((sum, entry) => sum + entry.count, 0);
  if (total !== 50) {
    throw new Error(`Rebuilt recipe for ${wrestler?.name || "unknown"} sums to ${total}, expected 50.`);
  }
  return out;
}

/**
 * One mirror match: same wrestler/preset on both sides, but each side uses a
 * different proportion split. `challengerIsPlayer` swaps which side gets which
 * recipe so initiative bias affects each side equally over the loop.
 */
function runMirrorMatch(seed, wrestler, challengerProps, baselineProps, challengerIsPlayer) {
  const random = makeRandomSource(seed);
  const baseRecipe = Engine.resolveDeckRecipe(wrestler, deckRecipe, deckPresets);

  const playerProps = challengerIsPlayer ? challengerProps : baselineProps;
  const enemyProps = challengerIsPlayer ? baselineProps : challengerProps;

  const playerRecipe = rebuildRecipeWithProportions(baseRecipe, playerProps, wrestler);
  const enemyRecipe = rebuildRecipeWithProportions(baseRecipe, enemyProps, wrestler);

  const playerName = `${wrestler.name} (${challengerIsPlayer ? "Challenger" : "Baseline"})`;
  const enemyName = `${wrestler.name} (${challengerIsPlayer ? "Baseline" : "Challenger"})`;

  const state = Engine.createMatch({
    random,
    player: {
      name: playerName,
      maneuverDeck: Engine.buildDeckForWrestler(wrestler, cardLookup, playerRecipe),
      shuffleManeuverDeck: true
    },
    enemy: {
      name: enemyName,
      maneuverDeck: Engine.buildDeckForWrestler(wrestler, cardLookup, enemyRecipe),
      shuffleManeuverDeck: true
    }
  });

  let safety = 0;
  let pinAttempts = 0;
  let lastPhase = state.phase;
  while (!state.match.over && safety < 5000) {
    safety += 1;
    if (state.phase === Engine.PHASES.PINFALL_DRAW && lastPhase !== Engine.PHASES.PINFALL_DRAW) {
      pinAttempts += 1;
    }
    lastPhase = state.phase;

    if (state.phase === Engine.PHASES.TURN_END) {
      Engine.continueAfterTurnEnd(state);
      continue;
    }
    if (state.phase === Engine.PHASES.PINFALL_DRAW) {
      Engine.drawNextPinfallCard(state);
      continue;
    }
    if (state.resolution?.awaitingDefenceChoice) {
      const choice = Engine.chooseAiDefence(state);
      if (choice.type === "none") {
        Engine.chooseNoDefence(state);
      } else {
        Engine.prepareDefence(state, choice.handIndex);
        Engine.callDefenceCoin(state);
      }
      continue;
    }
    if (state.phase === Engine.PHASES.CHOOSE_NEXT_ACTION) {
      const attackerKey = state.turn.attackerKey;
      const offence = Engine.chooseAiOffence(state, attackerKey);
      if (offence.type === "stop") Engine.stopTurn(state);
      else Engine.playOffensiveCard(state, offence.handIndex, attackerKey);
      continue;
    }
  }

  const winnerKey = state.match.winnerKey;
  const challengerWon =
    (challengerIsPlayer && winnerKey === "player") || (!challengerIsPlayer && winnerKey === "enemy");
  const reason = String(state.match.reason || "");
  const turns = state.turn?.number || 0;
  return {
    winnerKey,
    challengerWon,
    turns,
    pinWin: /wins by pinfall/i.test(reason),
    deckOut: /deck exhaustion/i.test(reason),
    firstTurnFinish: turns <= 1,
    pinAttempts,
    safetyAborted: safety >= 5000
  };
}

function runSweep({
  baseline = parseBaselineFromEnv(),
  configs = parseConfigsFromEnv(),
  matchesPerConfig = DEFAULT_MATCHES_PER_CONFIG
} = {}) {
  validateProportions("baseline", baseline);
  for (const config of configs) {
    validateProportions(`config "${config?.label || "?"}"`, config?.proportions);
  }

  const results = [];

  for (const config of configs) {
    let challengerWins = 0;
    let baselineWins = 0;
    let draws = 0;
    let totalTurns = 0;
    let pinWins = 0;
    let deckOuts = 0;
    let firstTurnFinishes = 0;
    let totalPinAttempts = 0;
    let aborted = 0;

    for (let i = 0; i < matchesPerConfig; i += 1) {
      const challengerIsPlayer = i % 2 === 0;
      const wrestler = wrestlers[Math.floor(i / 2) % wrestlers.length];
      const seed = i + 1;
      const result = runMirrorMatch(seed, wrestler, config.proportions, baseline, challengerIsPlayer);
      if (result.challengerWon) challengerWins += 1;
      else if (result.winnerKey) baselineWins += 1;
      else draws += 1;
      totalTurns += result.turns;
      if (result.pinWin) pinWins += 1;
      if (result.deckOut) deckOuts += 1;
      if (result.firstTurnFinish) firstTurnFinishes += 1;
      totalPinAttempts += result.pinAttempts;
      if (result.safetyAborted) aborted += 1;
    }

    results.push({
      label: config.label,
      proportions: config.proportions,
      baseline,
      matches: matchesPerConfig,
      challengerWinRate: challengerWins / matchesPerConfig,
      baselineWinRate: baselineWins / matchesPerConfig,
      draws,
      avgTurns: totalTurns / matchesPerConfig,
      pinFinishRate: pinWins / matchesPerConfig,
      deckOutRate: deckOuts / matchesPerConfig,
      firstTurnFinishRate: firstTurnFinishes / matchesPerConfig,
      avgPinAttempts: totalPinAttempts / matchesPerConfig,
      aborted
    });
  }

  return results;
}

/**
 * Approximate 95% Wald interval half-width for a win-rate observed over n trials.
 * Used to flag significant deviations from the 50% expectation.
 */
function ciHalfWidth(rate, n) {
  if (n <= 0) return 0;
  return 1.96 * Math.sqrt((rate * (1 - rate)) / n);
}

function describeProportions(p) {
  return `${p.attack}/${p.taunt}/${p.pin}/${p.dodge}/${p.reversal}`;
}

function printSummary(results) {
  console.log("\n=== UnderCard Deck Proportion Sweep ===");
  if (results.length === 0) {
    console.log("(no configurations were run)");
    return;
  }
  console.log(`Matches per config: ${results[0].matches}`);
  console.log(`Baseline (control): ${describeProportions(results[0].baseline)} (attack/taunt/pin/dodge/reversal)\n`);

  const cols = [
    { header: "challenger", width: 22 },
    { header: "A/T/P/D/R", width: 14 },
    { header: "C-win%", width: 9 },
    { header: "±95% CI", width: 10 },
    { header: "B-win%", width: 9 },
    { header: "verdict", width: 14 },
    { header: "avg turns", width: 11 },
    { header: "pin-win%", width: 11 },
    { header: "deck-out%", width: 12 },
    { header: "1-turn%", width: 10 },
    { header: "pin atts", width: 10 }
  ];

  console.log(cols.map((c) => c.header.padEnd(c.width)).join(""));
  console.log(cols.map((c) => "-".repeat(c.width - 1) + " ").join(""));

  for (const r of results) {
    const ci = ciHalfWidth(r.challengerWinRate, r.matches);
    const delta = r.challengerWinRate - 0.5;
    let verdict;
    if (Math.abs(delta) <= ci) {
      verdict = "≈ baseline";
    } else if (delta > 0) {
      verdict = delta > 0.05 ? "much stronger" : "stronger";
    } else {
      verdict = delta < -0.05 ? "much weaker" : "weaker";
    }
    const row = [
      r.label,
      describeProportions(r.proportions),
      `${(r.challengerWinRate * 100).toFixed(1)}%`,
      `${(ci * 100).toFixed(1)}%`,
      `${(r.baselineWinRate * 100).toFixed(1)}%`,
      verdict,
      r.avgTurns.toFixed(2),
      `${(r.pinFinishRate * 100).toFixed(1)}%`,
      `${(r.deckOutRate * 100).toFixed(1)}%`,
      `${(r.firstTurnFinishRate * 100).toFixed(1)}%`,
      r.avgPinAttempts.toFixed(2)
    ];
    console.log(cols.map((c, i) => String(row[i]).padEnd(c.width)).join(""));
  }

  const aborted = results.reduce((sum, r) => sum + r.aborted, 0);
  if (aborted > 0) {
    console.log(`\nWarning: ${aborted} match(es) hit the safety cutoff.`);
  }
  console.log("\nC-win% is the challenger's match win-rate against the baseline control.");
  console.log("±95% CI is the half-width of the Wald confidence interval at the observed rate.");
  console.log("Verdict marks the challenger as ≈ baseline / stronger / weaker once the gap exceeds the CI,");
  console.log("or 'much stronger / weaker' when it exceeds 5 percentage points.\n");
}

if (require.main === module) {
  const results = runSweep();
  printSummary(results);
}

module.exports = {
  DEFAULT_BASELINE,
  DEFAULT_SWEEP_CONFIGS,
  runSweep,
  runMirrorMatch,
  rebuildRecipeWithProportions,
  scaleEntriesToTarget
};
