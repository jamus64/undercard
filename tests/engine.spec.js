const { test, expect } = require("@playwright/test");
const Engine = require("../game-engine");

function attack(id, slot, damage, extras = {}) {
  return Engine.normalizeCard({
    id,
    name: extras.name || id,
    type: "attack",
    validSlot: slot,
    damage,
    reverseDamage: extras.reverseDamage || 0,
    missDamage: extras.missDamage || 0,
    afterUse: extras.afterUse || "discard",
    onSlotEffect: extras.onSlotEffect || [],
    offSlotEffect: extras.offSlotEffect || [],
    onHitEffects: extras.onHitEffects || [],
    onPinEffects: extras.onPinEffects || []
  });
}

function taunt(id, slot, onSlotEffect = [], offSlotEffect = [], extras = {}) {
  return Engine.normalizeCard({
    id,
    name: extras.name || id,
    type: "taunt",
    validSlot: slot,
    afterUse: extras.afterUse || "discard",
    onSlotEffect,
    offSlotEffect,
    onHitEffects: [],
    onPinEffects: []
  });
}

function pin(id, extras = {}) {
  return Engine.normalizeCard({
    id,
    name: extras.name || id,
    type: "pin",
    validSlot: "any",
    afterUse: extras.afterUse || "discard",
    onPinEffects: extras.onPinEffects || []
  });
}

function dodge(id = "dodge", extras = {}) {
  return Engine.normalizeCard({
    id,
    name: extras.name || id,
    type: "dodge",
    afterUse: extras.afterUse || "discard"
  });
}

function reversal(id = "reversal", extras = {}) {
  return Engine.normalizeCard({
    id,
    name: extras.name || id,
    type: "reversal",
    afterUse: extras.afterUse || "discard"
  });
}

function duplicate(card, suffix) {
  return Engine.normalizeCard({
    ...card,
    id: `${card.id}_${suffix}`,
    name: card.name
  });
}

function deckFromOpeningHand(cards, fillerFactory = () => dodge("pad_def")) {
  const deck = cards.map((card, index) => duplicate(card, index));

  while (deck.length < 6) {
    deck.push(duplicate(fillerFactory(), deck.length));
  }

  return deck;
}

function pinfallDeck(cards) {
  return [...cards];
}

function makeMatch(options = {}) {
  const playerDeck = options.playerDeck || deckFromOpeningHand([attack("p_atk_1", 1, 5)]);
  const enemyDeck = options.enemyDeck || deckFromOpeningHand([attack("e_atk_1", 1, 5)]);

  return Engine.createMatch({
    initiativeWinner: options.initiativeWinner || "player",
    random: options.random || [],
    player: {
      name: options.playerName || "Player",
      maneuverDeck: playerDeck,
      hand: options.playerHand || [],
      discardPile: options.playerDiscard || [],
      exhaustPile: options.playerExhaust || [],
      pinfallDeck:
        options.playerPinfallDeck ||
        pinfallDeck(["Fail", "Fail", "Fail", "Kickout", "Kickout", "Kickout", "Kickout", "Kickout", "Kickout", "Kickout"])
    },
    enemy: {
      name: options.enemyName || "Enemy",
      maneuverDeck: enemyDeck,
      hand: options.enemyHand || [],
      discardPile: options.enemyDiscard || [],
      exhaustPile: options.enemyExhaust || [],
      pinfallDeck:
        options.enemyPinfallDeck ||
        pinfallDeck(["Fail", "Fail", "Fail", "Kickout", "Kickout", "Kickout", "Kickout", "Kickout", "Kickout", "Kickout"])
    }
  });
}

function failCount(state, key) {
  return Engine.getPinfallSummary(state.players[key]).fail;
}

function continueTurn(state) {
  expect(state.phase).toBe(Engine.PHASES.TURN_END);
  Engine.continueAfterTurnEnd(state);
}

test("draws to 6 with discard reshuffle", () => {
  const state = makeMatch({
    initiativeWinner: "enemy",
    playerDeck: deckFromOpeningHand([attack("p1", 1, 5)]),
    enemyDeck: deckFromOpeningHand([attack("e1", 1, 5)])
  });

  state.players.player.hand = state.players.player.hand.slice(0, 4);
  state.players.player.maneuverDeck = [];
  state.players.player.discardPile = [
    attack("discard_a", 1, 5),
    attack("discard_b", 2, 5),
    taunt("discard_c", 3, [], [])
  ];

  Engine.stopTurn(state);
  continueTurn(state);

  expect(state.turn.attackerKey).toBe("player");
  expect(state.players.player.hand).toHaveLength(6);
  expect(state.players.player.maneuverDeck).toHaveLength(1);
  expect(state.players.player.discardPile).toHaveLength(0);
});

test("exhaust pile never reshuffles", () => {
  const state = makeMatch({
    initiativeWinner: "enemy",
    playerDeck: deckFromOpeningHand([attack("p1", 1, 5)]),
    enemyDeck: deckFromOpeningHand([attack("e1", 1, 5)])
  });

  state.players.player.hand = state.players.player.hand.slice(0, 5);
  state.players.player.maneuverDeck = [];
  state.players.player.discardPile = [attack("discard_only", 1, 5)];
  state.players.player.exhaustPile = [
    attack("exhaust_1", 1, 8, { afterUse: "exhaust" }),
    attack("exhaust_2", 2, 9, { afterUse: "exhaust" })
  ];

  Engine.stopTurn(state);
  continueTurn(state);

  const idsInPlay = [
    ...state.players.player.hand,
    ...state.players.player.maneuverDeck,
    ...state.players.player.discardPile
  ].map((card) => card.id);

  expect(state.turn.attackerKey).toBe("player");
  expect(idsInPlay).not.toContain("exhaust_1");
  expect(idsInPlay).not.toContain("exhaust_2");
  expect(state.players.player.exhaustPile).toHaveLength(2);
});

test("enforces sequential slots without manual slot choice", () => {
  const slotTwoAttack = attack("slot_two", 2, 7);
  const state = makeMatch({
    playerDeck: deckFromOpeningHand([slotTwoAttack, attack("keep_turn", 2, 5)]),
    enemyDeck: deckFromOpeningHand([attack("enemy_filler", 1, 4)], () => attack("enemy_pad", 1, 4))
  });

  Engine.playOffensiveCard(state, 0, "player");

  expect(state.turn.slots[0].card.name).toBe("slot_two");
  expect(state.turn.slots[0].slot).toBe(1);
  expect(state.turn.slots[0].onSlot).toBe(false);
  expect(state.turn.nextSlot).toBe(2);
});

test("supports voluntary stop early", () => {
  const state = makeMatch({
    playerDeck: deckFromOpeningHand([attack("p1", 1, 5), attack("p2", 2, 6)]),
    enemyDeck: deckFromOpeningHand([attack("e1", 1, 5)], () => attack("enemy_pad", 2, 4))
  });

  Engine.playOffensiveCard(state, 0, "player");
  Engine.stopTurn(state);

  expect(state.phase).toBe(Engine.PHASES.TURN_END);
  continueTurn(state);
  expect(state.turn.attackerKey).toBe("enemy");
  expect(state.log.some((entry) => entry.includes("stops the offensive sequence early"))).toBeTruthy();
});

test("ends the turn when no offensive card can be played", () => {
  const state = makeMatch({
    playerDeck: deckFromOpeningHand([dodge("pd1"), reversal("pr1"), dodge("pd2"), reversal("pr2"), dodge("pd3"), reversal("pr3")]),
    enemyDeck: deckFromOpeningHand([attack("enemy_attack", 1, 5)])
  });

  expect(state.phase).toBe(Engine.PHASES.TURN_END);
  continueTurn(state);
  expect(state.turn.attackerKey).toBe("enemy");
  expect(state.log.some((entry) => entry.includes("has no offensive card"))).toBeTruthy();
});

test("resolves an on-slot attack with no defence", () => {
  const state = makeMatch({
    playerDeck: deckFromOpeningHand([attack("strike", 1, 6), attack("follow_up", 2, 5)]),
    enemyDeck: deckFromOpeningHand([attack("enemy_attack", 1, 5)], () => attack("enemy_pad", 2, 4))
  });

  Engine.playOffensiveCard(state, 0, "player");

  expect(state.players.enemy.damage).toBe(6);
  expect(state.turn.slots[0].result).toBe("Landed");
});

test("gives the defender advantage against an off-slot attack", () => {
  const state = makeMatch({
    random: [0.1, 0.75, 0.2],
    playerDeck: deckFromOpeningHand([attack("offslot_attack", 2, 8)]),
    enemyDeck: deckFromOpeningHand([dodge("enemy_dodge"), attack("enemy_attack", 1, 5)])
  });

  Engine.playOffensiveCard(state, 0, "player");
  Engine.prepareDefence(state, 0);
  Engine.callDefenceCoin(state, "Heads");

  expect(state.phase).toBe(Engine.PHASES.TURN_END);
  continueTurn(state);
  expect(state.turn.attackerKey).toBe("enemy");
  expect(state.players.enemy.damage).toBe(0);
  expect(state.log.some((entry) => entry.includes("turn ends immediately"))).toBeTruthy();
});

test("successful defence ends the attacker's turn immediately", () => {
  const state = makeMatch({
    random: [0.1, 0.75],
    playerDeck: deckFromOpeningHand([attack("onslot_attack", 1, 8)]),
    enemyDeck: deckFromOpeningHand([reversal("enemy_reversal"), attack("enemy_attack", 1, 5)])
  });

  Engine.playOffensiveCard(state, 0, "player");
  Engine.prepareDefence(state, 0);
  Engine.callDefenceCoin(state, "Heads");

  expect(state.phase).toBe(Engine.PHASES.TURN_END);
  continueTurn(state);
  expect(state.turn.attackerKey).toBe("enemy");
  expect(state.players.enemy.damage).toBe(0);
  expect(state.log.some((entry) => entry.includes("turn ends immediately"))).toBeTruthy();
});

test("successful dodge applies missDamage to attacker", () => {
  const state = makeMatch({
    random: [0.1, 0.75],
    playerDeck: deckFromOpeningHand([attack("onslot_attack", 1, 8, { missDamage: 4 })]),
    enemyDeck: deckFromOpeningHand([dodge("enemy_dodge"), attack("enemy_attack", 1, 5)])
  });

  Engine.playOffensiveCard(state, 0, "player");
  Engine.prepareDefence(state, 0);
  Engine.callDefenceCoin(state, "Heads");

  expect(state.players.player.damage).toBe(4);
  expect(state.log.some((entry) => entry.includes("takes 4 damage from a missed attack"))).toBeTruthy();
});

test("successful reversal applies reverseDamage to attacker", () => {
  const state = makeMatch({
    random: [0.1, 0.75],
    playerDeck: deckFromOpeningHand([attack("onslot_attack", 1, 8, { reverseDamage: 6 })]),
    enemyDeck: deckFromOpeningHand([reversal("enemy_reversal"), attack("enemy_attack", 1, 5)])
  });

  Engine.playOffensiveCard(state, 0, "player");
  Engine.prepareDefence(state, 0);
  Engine.callDefenceCoin(state, "Heads");

  expect(state.players.player.damage).toBe(6);
  expect(state.log.some((entry) => entry.includes("takes 6 damage from a reversal"))).toBeTruthy();
});

test("taunts are undefendable on-slot and off-slot", () => {
  const onSlotState = makeMatch({
    playerDeck: deckFromOpeningHand([
      taunt("on_slot_taunt", 1, [{ type: "add_pinfall", card: "Fail", target: "opponent", amount: 1 }], [])
    ]),
    enemyDeck: deckFromOpeningHand([dodge("enemy_dodge"), reversal("enemy_reversal"), attack("enemy_attack", 1, 5)])
  });

  const offSlotState = makeMatch({
    playerDeck: deckFromOpeningHand([
      taunt("off_slot_taunt", 2, [{ type: "add_pinfall", card: "Fail", target: "opponent", amount: 1 }], [])
    ]),
    enemyDeck: deckFromOpeningHand([dodge("enemy_dodge"), reversal("enemy_reversal"), attack("enemy_attack", 1, 5)])
  });

  const onSlotFailStart = failCount(onSlotState, "enemy");
  const offSlotFailStart = failCount(offSlotState, "enemy");

  Engine.playOffensiveCard(onSlotState, 0, "player");
  Engine.playOffensiveCard(offSlotState, 0, "player");

  expect(failCount(onSlotState, "enemy")).toBe(onSlotFailStart + 1);
  expect(failCount(offSlotState, "enemy")).toBe(offSlotFailStart);
  expect(onSlotState.players.enemy.hand).toHaveLength(6);
  expect(offSlotState.players.enemy.hand).toHaveLength(6);
});

test("playing a pin ends the offensive sequence and enters pin flow", () => {
  const state = makeMatch({
    playerDeck: deckFromOpeningHand([pin("quick_pin"), attack("follow_up", 2, 6)]),
    enemyDeck: deckFromOpeningHand([attack("enemy_attack", 1, 5)])
  });

  state.players.enemy.hand = [];

  Engine.playOffensiveCard(state, 0, "player");

  expect(state.phase).toBe(Engine.PHASES.PINFALL_DRAW);
  expect(state.pinAttempt).not.toBeNull();
  expect(state.turn.nextSlot).toBe(2);
});

test("pin reversals can chain repeatedly", () => {
  const state = makeMatch({
    random: [0.1, 0.75, 0.1, 0.75],
    playerDeck: deckFromOpeningHand([pin("chain_pin"), reversal("player_reversal")]),
    enemyDeck: deckFromOpeningHand([reversal("enemy_reversal"), attack("enemy_attack", 1, 5)])
  });

  Engine.playOffensiveCard(state, 0, "player");
  Engine.prepareDefence(state, 0);
  Engine.callDefenceCoin(state, "Heads");

  expect(state.phase).toBe(Engine.PHASES.PIN_DEFENCE_DECISION);
  expect(state.resolution.defenderKey).toBe("player");

  Engine.prepareDefence(state, 0);
  Engine.callDefenceCoin(state, "Heads");

  expect(state.phase).toBe(Engine.PHASES.PIN_DEFENCE_DECISION);
  expect(state.resolution.defenderKey).toBe("enemy");
});

test("Kickout ends the pin and returns drawn cards to the pinfall deck", () => {
  const state = makeMatch({
    playerDeck: deckFromOpeningHand([pin("quick_pin")]),
    enemyDeck: deckFromOpeningHand([attack("enemy_attack", 1, 5)], () => attack("enemy_pad", 2, 4)),
    enemyPinfallDeck: pinfallDeck(["Kickout", "Fail", "Fail"])
  });

  Engine.playOffensiveCard(state, 0, "player");
  Engine.drawNextPinfallCard(state);

  expect(state.pinAttempt).toBeNull();
  expect(state.phase).toBe(Engine.PHASES.TURN_END);
  continueTurn(state);
  expect(state.turn.attackerKey).toBe("enemy");
  expect(state.players.enemy.pinfallDeck).toHaveLength(3);
});

test("three Fail cards in a row ends the match immediately", () => {
  const state = makeMatch({
    playerDeck: deckFromOpeningHand([pin("match_ender")]),
    enemyDeck: deckFromOpeningHand([attack("enemy_attack", 1, 5)]),
    enemyPinfallDeck: pinfallDeck(["Fail", "Fail", "Fail"])
  });

  state.players.enemy.hand = [];

  Engine.playOffensiveCard(state, 0, "player");
  Engine.drawNextPinfallCard(state);
  Engine.drawNextPinfallCard(state);
  Engine.drawNextPinfallCard(state);

  expect(state.match.over).toBeTruthy();
  expect(state.match.winnerKey).toBe("player");
  expect(state.phase).toBe(Engine.PHASES.MATCH_END);
});

test("adds a Fail card on combo success", () => {
  const state = makeMatch({
    playerDeck: deckFromOpeningHand([
      attack("combo_1", 1, 4),
      attack("combo_2", 2, 4),
      taunt("combo_3", 3, [], [])
    ]),
    enemyDeck: deckFromOpeningHand([attack("enemy_attack", 1, 5)], () => attack("enemy_pad", 2, 4))
  });
  const failStart = failCount(state, "enemy");

  Engine.playOffensiveCard(state, 0, "player");
  Engine.playOffensiveCard(state, 0, "player");
  Engine.playOffensiveCard(state, 0, "player");

  expect(failCount(state, "enemy")).toBe(failStart + 1);
  expect(state.phase).toBe(Engine.PHASES.TURN_END);
  continueTurn(state);
  expect(state.turn.attackerKey).toBe("enemy");
});

test("off-slot cards do not count toward combo", () => {
  const state = makeMatch({
    playerDeck: deckFromOpeningHand([
      attack("combo_1", 1, 4),
      attack("combo_breaker", 1, 4),
      taunt("combo_3", 3, [], [])
    ]),
    enemyDeck: deckFromOpeningHand([attack("enemy_attack", 1, 5)], () => attack("enemy_pad", 2, 4))
  });
  const failStart = failCount(state, "enemy");

  Engine.playOffensiveCard(state, 0, "player");
  Engine.playOffensiveCard(state, 0, "player");
  Engine.playOffensiveCard(state, 0, "player");

  expect(failCount(state, "enemy")).toBe(failStart);
});

test("successful defence prevents combo rewards", () => {
  const state = makeMatch({
    random: [0.1, 0.75],
    playerDeck: deckFromOpeningHand([
      attack("combo_1", 1, 4),
      attack("combo_2", 2, 4),
      attack("combo_3", 3, 4)
    ]),
    enemyDeck: deckFromOpeningHand([dodge("enemy_dodge"), attack("enemy_attack", 1, 5)])
  });

  const failStart = failCount(state, "enemy");

  Engine.playOffensiveCard(state, 0, "player");
  Engine.prepareDefence(state, 0);
  Engine.callDefenceCoin(state, "Heads");

  expect(failCount(state, "enemy")).toBe(failStart);
  expect(state.phase).toBe(Engine.PHASES.TURN_END);
  continueTurn(state);
  expect(state.turn.attackerKey).toBe("enemy");
});

test("failed pin does not reopen the next slot on the same turn", () => {
  const state = makeMatch({
    playerDeck: deckFromOpeningHand([
      attack("slot_1_attack", 1, 4),
      pin("slot_2_pin"),
      attack("slot_3_attack", 3, 7)
    ]),
    enemyDeck: deckFromOpeningHand([attack("enemy_attack", 1, 5)], () => attack("enemy_pad", 2, 4)),
    enemyPinfallDeck: pinfallDeck(["Kickout", "Fail", "Fail"])
  });

  state.players.enemy.hand = [];

  Engine.playOffensiveCard(state, 0, "player");
  Engine.playOffensiveCard(state, 0, "player");
  Engine.drawNextPinfallCard(state);

  expect(state.phase).toBe(Engine.PHASES.TURN_END);
  expect(state.turn.attackerKey).toBe("player");
  expect(state.turn.nextSlot).toBe(3);
  expect(state.turn.slots[2].card).toBeNull();
});

test("adds Fail cards immediately at 10, 20, and 30 damage", () => {
  const state = makeMatch({
    playerDeck: deckFromOpeningHand([
      attack("ten_1", 1, 10),
      attack("ten_2", 2, 10),
      attack("ten_3", 1, 10)
    ]),
    enemyDeck: deckFromOpeningHand([attack("enemy_attack", 1, 5)], () => attack("enemy_pad", 2, 4))
  });
  const failStart = failCount(state, "enemy");

  Engine.playOffensiveCard(state, 0, "player");
  expect(failCount(state, "enemy")).toBe(failStart + 1);

  Engine.playOffensiveCard(state, 0, "player");
  expect(failCount(state, "enemy")).toBe(failStart + 2);

  Engine.playOffensiveCard(state, 0, "player");
  expect(failCount(state, "enemy")).toBe(failStart + 3);
});
