const assert = require("node:assert/strict");
const Engine = require("../game-engine");
const cardPool = require("../data/card-pool.json");
const deckRecipe = require("../data/deck-recipe.json");
const wrestlers = require("../data/wrestlers.json");

function buildCardLookup(cards) {
  return Object.fromEntries(cards.map((card) => [card.id, card]));
}

function simulateSingleMatch(cardLookup) {
  const player = wrestlers[0];
  const enemy = wrestlers[1] || wrestlers[0];

  const state = Engine.createMatch({
    random: [0.1, 0.6, 0.2, 0.7, 0.3, 0.8],
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
    attack: 24,
    taunt: 12,
    pin: 4,
    dodge: 4,
    reversal: 4
  };

  const recipeSize = deckRecipe.reduce((sum, entry) => sum + Number(entry.count || 0), 0);
  assert.equal(recipeSize, 48, "Deck recipe must total 48 cards");

  for (const wrestler of wrestlers) {
    assert.ok(wrestler.name, "Wrestler must have a name");
    assert.ok(wrestler.category, `Wrestler ${wrestler.name} must have a category`);

    const deck = Engine.buildDeckForWrestler(wrestler, cardLookup, deckRecipe);
    assert.equal(deck.length, 48, `Deck for ${wrestler.name} must have 48 cards`);

    const byType = {};
    let categoryAttackCount = 0;
    for (const card of deck) {
      byType[card.type] = (byType[card.type] || 0) + 1;
      if (card.type === "attack" && String(card.category || "").toLowerCase() === String(wrestler.category).toLowerCase()) {
        categoryAttackCount += 1;
      }
    }

    for (const [type, count] of Object.entries(expectedByType)) {
      assert.equal(byType[type] || 0, count, `${wrestler.name} deck should have ${count} ${type} cards`);
    }
    assert.ok(categoryAttackCount > 0, `${wrestler.name} should have at least one category attack`);
  }

  simulateSingleMatch(cardLookup);
  console.log("Smoke suite passed.");
}

main();
