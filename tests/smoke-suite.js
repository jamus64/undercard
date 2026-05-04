const assert = require("node:assert/strict");
const Engine = require("../game-engine");
const cardPool = require("../data/card-pool.json");
const deckRecipe = require("../data/deck-recipe.json");
const wrestlers = require("../data/wrestlers.json");

/** Stable seed so CI is reproducible; picks a matchup other than hardcoding wrestlers[0] vs wrestlers[1]. */
const SMOKE_MATCH_SEED = Number(process.env.SMOKE_SUITE_SEED || 97531);

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

function pickTwoWrestlers(random) {
  const n = wrestlers.length;
  const playerIndex = Math.floor(random() * n);
  let enemyIndex = Math.floor(random() * n);
  if (enemyIndex === playerIndex && n > 1) {
    enemyIndex = (enemyIndex + 1) % n;
  }
  return {
    player: wrestlers[playerIndex],
    enemy: wrestlers[enemyIndex] || wrestlers[playerIndex]
  };
}

function simulateSingleMatch(cardLookup) {
  const random = makeRandomSource(SMOKE_MATCH_SEED);
  const { player, enemy } = pickTwoWrestlers(random);

  const state = Engine.createMatch({
    random,
    player: {
      name: player.name,
      maneuverDeck: Engine.buildDeckForWrestler(player, cardLookup, deckRecipe),
      shuffleManeuverDeck: true
    },
    enemy: {
      name: enemy.name,
      maneuverDeck: Engine.buildDeckForWrestler(enemy, cardLookup, deckRecipe),
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

  assert.equal(state.match.over, true, "Simulation should end before safety limit");
}

function main() {
  const cardLookup = buildCardLookup(cardPool);
  const expectedByType = {
    attack: 26,
    taunt: 12,
    pin: 4,
    dodge: 4,
    reversal: 4
  };

  const recipeSize = deckRecipe.reduce((sum, entry) => sum + Number(entry.count || 0), 0);
  assert.equal(recipeSize, 50, "Deck recipe must total 50 cards");
  const commentedKeys = cardPool.flatMap((card) => Object.keys(card).filter((key) => key.startsWith("// ")));
  assert.equal(commentedKeys.length, 0, "card-pool should not contain commented metadata keys");

  for (const wrestler of wrestlers) {
    assert.ok(wrestler.name, "Wrestler must have a name");
    assert.ok(wrestler.category, `Wrestler ${wrestler.name} must have a category`);

    const deck = Engine.buildDeckForWrestler(wrestler, cardLookup, deckRecipe);
    assert.equal(deck.length, 50, `Deck for ${wrestler.name} must have 50 cards`);

    const byType = {};
    const byRarity = {};
    const byCardId = {};
    let categoryAttackCount = 0;
    for (const card of deck) {
      byType[card.type] = (byType[card.type] || 0) + 1;
      byRarity[card.rarity] = (byRarity[card.rarity] || 0) + 1;
      byCardId[card.id] = (byCardId[card.id] || 0) + 1;
      if (card.type === "attack" && String(card.category || "").toLowerCase() === String(wrestler.category).toLowerCase()) {
        categoryAttackCount += 1;
      }
    }

    for (const [type, count] of Object.entries(expectedByType)) {
      assert.equal(byType[type] || 0, count, `${wrestler.name} deck should have ${count} ${type} cards`);
    }
    for (const [cardId, count] of Object.entries(byCardId)) {
      const source = cardLookup[cardId];
      const rarity = source?.rarity || "common";
      const limit = rarity === "common" ? 4 : rarity === "uncommon" ? 3 : 2;
      assert.ok(count <= limit, `${wrestler.name} exceeds copy limit for ${cardId} (${rarity})`);
    }
    assert.ok((byRarity.special || 0) >= 2, `${wrestler.name} should include special cards when available`);
    assert.ok(categoryAttackCount > 0, `${wrestler.name} should have at least one category attack`);
  }

  simulateSingleMatch(cardLookup);
  console.log("Smoke suite passed.");
}

main();
