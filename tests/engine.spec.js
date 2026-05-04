const { test, expect } = require("@playwright/test");
const Engine = require("../game-engine");
const CARD_POOL = require("../data/card-pool.json");

const ON_TAUNT_RESOLVE = "on_taunt_resolve";

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
    ...(extras.effectOps ? { effectOps: extras.effectOps } : {})
  });
}

function taunt(id, slot, extras = {}) {
  return Engine.normalizeCard({
    id,
    name: extras.name || id,
    type: "taunt",
    validSlot: slot,
    afterUse: extras.afterUse || "discard",
    effectOps: extras.effectOps || []
  });
}

function pin(id, extras = {}) {
  return Engine.normalizeCard({
    id,
    name: extras.name || id,
    type: "pin",
    validSlot: "any",
    afterUse: extras.afterUse || "discard",
    ...(extras.effectOps ? { effectOps: extras.effectOps } : {})
  });
}

function tauntAddsOpponentFail(amount = 1) {
  return {
    when: ON_TAUNT_RESOLVE,
    ops: [{ type: "add_pinfall_to", targetKey: "defenderKey", pinCard: "Fail", amount }]
  };
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

function cardById(id) {
  const raw = CARD_POOL.find((c) => c.id === id);
  if (!raw) {
    throw new Error(`Unknown card id for tests: ${id}`);
  }
  return Engine.normalizeCard(raw);
}

function sizedOpeningDeck(cards) {
  const deck = cards.map((entry) => (typeof entry === "string" ? cardById(entry) : entry));
  let filler = 0;
  while (deck.length < 6) {
    deck.push(
      Engine.normalizeCard({
        id: `test_filler_${filler}`,
        name: "Filler",
        type: "attack",
        csvSlot: "1/2/3",
        damage: 1,
        reverseDamage: 1,
        missDamage: 0,
        afterUse: "discard"
      })
    );
    filler += 1;
  }
  return deck;
}

function dodgeOnlyDeck(count = 6) {
  return Array.from({ length: count }, (_, i) =>
    Engine.normalizeCard({
      id: `test_dodge_${i}`,
      name: "Dodge",
      type: "dodge",
      afterUse: "discard"
    })
  );
}

function anySlotAttack(id, damage = 1) {
  return Engine.normalizeCard({
    id,
    name: id,
    type: "attack",
    csvSlot: "1/2/3",
    damage,
    reverseDamage: 1,
    missDamage: 0,
    afterUse: "discard"
  });
}

function failCount(state, key) {
  return Engine.getPinfallSummary(state.players[key]).fail;
}

function continueTurn(state) {
  expect(state.phase).toBe(Engine.PHASES.TURN_END);
  Engine.continueAfterTurnEnd(state);
}

test("cannot draw from discard and loses by deck exhaustion", () => {
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
    taunt("discard_c", 3)
  ];

  Engine.stopTurn(state);
  continueTurn(state);

  expect(state.match.over).toBeTruthy();
  expect(state.match.winnerKey).toBe("enemy");
  expect(state.match.reason).toContain("wins by deck exhaustion");
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

test("player loses by deck exhaustion immediately at draw phase", () => {
  const state = makeMatch({
    initiativeWinner: "enemy",
    playerDeck: deckFromOpeningHand([attack("p1", 1, 5)]),
    enemyDeck: deckFromOpeningHand([attack("e1", 1, 5)])
  });

  state.players.player.hand = [attack("last_play", 1, 4)];
  state.players.player.maneuverDeck = [];
  state.players.player.discardPile = [];

  Engine.stopTurn(state);
  continueTurn(state);

  expect(state.match.over).toBeTruthy();
  expect(state.match.winnerKey).toBe("enemy");
  expect(state.match.reason).toContain("wins by deck exhaustion");
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
  expect(state.log.some((entry) => entry.includes("Counter-damage to") && entry.includes(": 4."))).toBeTruthy();
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
  expect(state.log.some((entry) => entry.includes("Counter-damage to") && entry.includes(": 6."))).toBeTruthy();
});

test("successful taunt defence cancels taunt and ends attacker's turn", () => {
  const state = makeMatch({
    random: [0.1, 0.75],
    playerDeck: deckFromOpeningHand([
      taunt("on_slot_taunt", 1, { effectOps: [tauntAddsOpponentFail()] })
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
  expect(state.log.some((entry) => entry.includes("turn ends immediately"))).toBeTruthy();
});

test("failed taunt defence allows taunt effect to resolve", () => {
  const state = makeMatch({
    random: [0.75, 0.1],
    playerDeck: deckFromOpeningHand([
      taunt("on_slot_taunt", 1, { effectOps: [tauntAddsOpponentFail()] }),
      attack("follow_slot2", 2, 5),
      attack("follow_slot3", 3, 5)
    ]),
    enemyDeck: deckFromOpeningHand([dodge("enemy_dodge"), attack("enemy_attack", 1, 5)])
  });

  const failStart = failCount(state, "enemy");

  Engine.playOffensiveCard(state, 0, "player");
  Engine.prepareDefence(state, 0);
  Engine.callDefenceCoin(state, "Heads");

  expect(failCount(state, "enemy")).toBe(failStart + 1);
  expect(state.phase).toBe(Engine.PHASES.CHOOSE_NEXT_ACTION);
  expect(state.log.some((entry) => entry.includes("uses on_slot_taunt"))).toBeTruthy();
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
      taunt("combo_3", 3)
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
      taunt("combo_3", 3)
    ]),
    enemyDeck: deckFromOpeningHand([attack("enemy_attack", 1, 5)], () => attack("enemy_pad", 2, 4))
  });
  const failStart = failCount(state, "enemy");

  Engine.playOffensiveCard(state, 0, "player");
  Engine.playOffensiveCard(state, 0, "player");
  Engine.playOffensiveCard(state, 0, "player");

  expect(failCount(state, "enemy")).toBe(failStart);
});

test("cards with csvSlot can be played in any listed slot", () => {
  const state = makeMatch({
    playerDeck: deckFromOpeningHand([
      Engine.normalizeCard({
        id: "multi_slot_attack",
        name: "multi_slot_attack",
        type: "attack",
        csvSlot: "1/3",
        damage: 5,
        afterUse: "discard"
      }),
      attack("filler_attack", 2, 1)
    ]),
    enemyDeck: deckFromOpeningHand([attack("enemy_attack", 1, 5)])
  });

  state.turn.nextSlot = 3;
  Engine.playOffensiveCard(state, 0, "player");

  expect(state.turn.slots[2].card?.id).toBe("multi_slot_attack_0");
  expect(state.turn.slots[2].onSlot).toBe(true);
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

test("effect: clothesline on slot 1 applies defender disadvantage mode", () => {
  const state = makeMatch({
    playerDeck: sizedOpeningDeck(["clothesline"]),
    enemyDeck: dodgeOnlyDeck()
  });
  Engine.playOffensiveCard(state, 0, "player");
  Engine.prepareDefence(state, 0);
  expect(state.resolution.defence.coinMode).toBe("disadvantage");
});

test("effect: jab adds +1 damage to the next attack this turn", () => {
  const state = makeMatch({
    playerDeck: sizedOpeningDeck(["jab", "elbow_drop"]),
    enemyDeck: dodgeOnlyDeck()
  });
  state.players.enemy.hand = [];
  Engine.playOffensiveCard(state, 0, "player");
  expect(state.players.enemy.damage).toBe(1);
  Engine.playOffensiveCard(state, 0, "player");
  expect(state.players.enemy.damage).toBe(8);
});

test("effect: dropkick in slot 3 gains temporary +2 attack damage", () => {
  const state = makeMatch({
    playerDeck: sizedOpeningDeck(["dropkick"]),
    enemyDeck: dodgeOnlyDeck()
  });
  state.players.enemy.hand = [];
  state.turn.nextSlot = 3;
  Engine.playOffensiveCard(state, 0, "player");
  expect(state.players.enemy.damage).toBe(6);
});

test("effect: spear on hit queues an immediate pin attempt", () => {
  const state = makeMatch({
    playerDeck: sizedOpeningDeck(["spear"]),
    enemyDeck: dodgeOnlyDeck()
  });
  state.players.enemy.hand = [];
  Engine.playOffensiveCard(state, 0, "player");
  expect(state.phase).toBe(Engine.PHASES.PINFALL_DRAW);
  expect(state.pinAttempt).not.toBeNull();
});

test("effect: frog splash after a taunt applies defender disadvantage", () => {
  const state = makeMatch({
    playerDeck: sizedOpeningDeck([anySlotAttack("slot_opener"), "shush", "frog_splash"]),
    enemyDeck: dodgeOnlyDeck()
  });
  Engine.playOffensiveCard(state, 0, "player");
  Engine.chooseNoDefence(state);
  Engine.playOffensiveCard(state, 0, "player");
  Engine.chooseNoDefence(state);
  Engine.playOffensiveCard(state, 0, "player");
  Engine.prepareDefence(state, 0);
  expect(state.resolution.defence.coinMode).toBe("disadvantage");
});

test("effect: headbutt deals self damage on hit", () => {
  const state = makeMatch({
    playerDeck: sizedOpeningDeck([anySlotAttack("slot1_pad"), "headbutt"]),
    enemyDeck: dodgeOnlyDeck()
  });
  state.players.enemy.hand = [];
  Engine.playOffensiveCard(state, 0, "player");
  Engine.playOffensiveCard(state, 0, "player");
  expect(state.players.player.damage).toBe(3);
  expect(state.players.enemy.damage).toBe(6);
});

test("effect: german suplex adds Fail to defender on hit", () => {
  const state = makeMatch({
    playerDeck: sizedOpeningDeck([anySlotAttack("slot1_pad"), "german_suplex"]),
    enemyDeck: dodgeOnlyDeck()
  });
  state.players.enemy.hand = [];
  const start = failCount(state, "enemy");
  Engine.playOffensiveCard(state, 0, "player");
  Engine.playOffensiveCard(state, 0, "player");
  expect(failCount(state, "enemy")).toBe(start + 1);
});

test("effect: powerbomb adds Kickout to attacker on hit", () => {
  const state = makeMatch({
    playerDeck: sizedOpeningDeck([
      anySlotAttack("slot1_pad"),
      anySlotAttack("slot2_pad"),
      "powerbomb"
    ]),
    enemyDeck: dodgeOnlyDeck()
  });
  state.players.enemy.hand = [];
  const koStart = Engine.getPinfallSummary(state.players.player).kickout;
  Engine.playOffensiveCard(state, 0, "player");
  Engine.playOffensiveCard(state, 0, "player");
  Engine.playOffensiveCard(state, 0, "player");
  expect(Engine.getPinfallSummary(state.players.player).kickout).toBe(koStart + 1);
});

test("effect: roar adds +2 damage to the next attack this turn", () => {
  const state = makeMatch({
    playerDeck: sizedOpeningDeck([anySlotAttack("slot1_pad"), "roar", "dropkick"]),
    enemyDeck: dodgeOnlyDeck()
  });
  state.players.enemy.hand = [];
  Engine.playOffensiveCard(state, 0, "player");
  Engine.playOffensiveCard(state, 0, "player");
  Engine.playOffensiveCard(state, 0, "player");
  expect(state.players.enemy.damage).toBe(9);
});

test("effect: gun show D20 contest gives attacker +1 on win", () => {
  const state = makeMatch({
    random: [0.95, 0.02, 0.9, 0.1],
    playerDeck: sizedOpeningDeck(["gun_show", "german_suplex"]),
    enemyDeck: dodgeOnlyDeck()
  });
  state.players.enemy.hand = [];
  Engine.playOffensiveCard(state, 0, "player");
  Engine.playOffensiveCard(state, 0, "player");
  expect(state.players.enemy.damage).toBe(6);
});

test("effect: hulk up grants slot line damage bonus on listed slots", () => {
  const state = makeMatch({
    playerDeck: sizedOpeningDeck(["hulk_up", "elbow_drop"]),
    enemyDeck: dodgeOnlyDeck()
  });
  state.players.enemy.hand = [];
  Engine.playOffensiveCard(state, 0, "player");
  Engine.playOffensiveCard(state, 0, "player");
  expect(state.players.enemy.damage).toBe(8);
});

test("effect: cheap shot hit discards randomly from defender hand", () => {
  const state = makeMatch({
    random: [0.05],
    playerDeck: sizedOpeningDeck(["cheap_shot"]),
    enemyDeck: dodgeOnlyDeck()
  });
  Engine.playOffensiveCard(state, 0, "player");
  Engine.chooseNoDefence(state);
  expect(state.players.enemy.hand).toHaveLength(5);
});

test("effect: wild swing defended stuns attacker (stun survives successful_defence turn end)", () => {
  const state = makeMatch({
    random: [0.02, 0.95],
    playerDeck: sizedOpeningDeck([anySlotAttack("slot1_pad"), "wild_swing"]),
    enemyDeck: dodgeOnlyDeck()
  });
  Engine.playOffensiveCard(state, 0, "player");
  Engine.chooseNoDefence(state);
  Engine.playOffensiveCard(state, 0, "player");
  Engine.prepareDefence(state, 0);
  Engine.callDefenceCoin(state, "Heads");
  expect(state.players.player.stunned).toBe(true);
  expect(state.phase).toBe(Engine.PHASES.TURN_END);
  continueTurn(state);
  expect(state.turn.attackerKey).toBe("enemy");
  expect(state.players.player.stunned).toBe(true);
});

test("effect: eye rake defended adds Fail to attacker", () => {
  const state = makeMatch({
    random: [0.02, 0.95],
    playerDeck: sizedOpeningDeck([anySlotAttack("slot1_pad"), "eye_rake"]),
    enemyDeck: dodgeOnlyDeck()
  });
  const startFails = failCount(state, "player");
  Engine.playOffensiveCard(state, 0, "player");
  Engine.chooseNoDefence(state);
  Engine.playOffensiveCard(state, 0, "player");
  Engine.prepareDefence(state, 0);
  Engine.callDefenceCoin(state, "Heads");
  expect(failCount(state, "player")).toBe(startFails + 1);
});

test("effect: ref distraction lets low blow ignore defended penalty once", () => {
  const state = makeMatch({
    random: [0.05, 0.92],
    playerDeck: sizedOpeningDeck(["ref_distraction", "low_blow"]),
    enemyDeck: dodgeOnlyDeck()
  });
  const failStart = failCount(state, "player");
  Engine.playOffensiveCard(state, 0, "player");
  Engine.chooseNoDefence(state);
  Engine.playOffensiveCard(state, 0, "player");
  Engine.prepareDefence(state, 0);
  Engine.callDefenceCoin(state, "Heads");
  expect(failCount(state, "player")).toBe(failStart);
});

test("effect: low blow defended without ref bypass adds two Fails to attacker", () => {
  const state = makeMatch({
    random: [0.05, 0.92],
    playerDeck: sizedOpeningDeck([anySlotAttack("slot1_pad"), "low_blow"]),
    enemyDeck: dodgeOnlyDeck()
  });
  const failStart = failCount(state, "player");
  Engine.playOffensiveCard(state, 0, "player");
  Engine.chooseNoDefence(state);
  Engine.playOffensiveCard(state, 0, "player");
  Engine.prepareDefence(state, 0);
  Engine.callDefenceCoin(state, "Heads");
  expect(failCount(state, "player")).toBe(failStart + 2);
});

test("effect: 450 splash on successful dodge discards two cards from attacker", () => {
  const state = makeMatch({
    random: [0.02, 0.95, 0.01, 0.01],
    playerDeck: sizedOpeningDeck([
      anySlotAttack("s1"),
      anySlotAttack("s2"),
      "450_splash"
    ]),
    enemyDeck: dodgeOnlyDeck()
  });
  Engine.playOffensiveCard(state, 0, "player");
  Engine.chooseNoDefence(state);
  Engine.playOffensiveCard(state, 0, "player");
  Engine.chooseNoDefence(state);
  Engine.playOffensiveCard(state, 0, "player");
  expect(state.players.player.hand).toHaveLength(3);
  Engine.prepareDefence(state, 0);
  Engine.callDefenceCoin(state, "Heads");
  expect(state.players.player.hand).toHaveLength(1);
});

test("effect: stunned attacker grants defender advantage on defence rolls", () => {
  const state = makeMatch({
    playerDeck: sizedOpeningDeck(["jab"]),
    enemyDeck: dodgeOnlyDeck()
  });
  state.players.player.stunned = true;
  Engine.playOffensiveCard(state, 0, "player");
  Engine.prepareDefence(state, 0);
  expect(state.resolution.defence.coinMode).toBe("advantage");
});

test("effect: stunned defender rolls defence at disadvantage", () => {
  const state = makeMatch({
    initiativeWinner: "enemy",
    enemyDeck: sizedOpeningDeck(["jab"]),
    playerDeck: dodgeOnlyDeck()
  });
  state.players.player.stunned = true;
  Engine.playOffensiveCard(state, 0, "enemy");
  Engine.prepareDefence(state, 0);
  expect(state.resolution.defence.coinMode).toBe("disadvantage");
});

test("effect: stun clears at end of the stunned wrestler's offensive turn (rules.txt)", () => {
  const state = makeMatch({
    playerDeck: sizedOpeningDeck(["jab"]),
    enemyDeck: dodgeOnlyDeck()
  });
  state.players.player.stunned = true;
  Engine.playOffensiveCard(state, 0, "player");
  Engine.chooseNoDefence(state);
  Engine.stopTurn(state);
  expect(state.phase).toBe(Engine.PHASES.TURN_END);
  Engine.continueAfterTurnEnd(state);
  expect(state.players.player.stunned).toBe(false);
});
