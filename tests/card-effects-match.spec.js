const { test, expect } = require("@playwright/test");
const Engine = require("../game-engine");
const CARD_POOL = require("../data/card-pool.json");

const CARD_BY_ID = Object.fromEntries(CARD_POOL.map((card) => [card.id, card]));
// Explicit deck skips shuffle RNG in createMatch (matches engine default starting composition).
const FIXED_PINFALL_DECK = [
  ...Array(Engine.constants.STARTING_PIN_FAILS).fill("Fail"),
  ...Array(Engine.constants.STARTING_PIN_KICKOUTS).fill("Kickout")
];
const EFFECT_CARD_IDS = CARD_POOL.filter((card) => String(card.effect || "").trim())
  .map((card) => card.id)
  .sort();

function cardClone(id, suffix) {
  const base = CARD_BY_ID[id];
  if (!base) {
    throw new Error(`Unknown card id: ${id}`);
  }
  const normalized = Engine.normalizeCard(base);
  return Engine.normalizeCard({
    ...normalized,
    id: `${id}_${suffix}`,
    name: normalized.name || id
  });
}

function failCount(state, key) {
  return Engine.getPinfallSummary(state.players[key]).fail;
}

function kickoutCount(state, key) {
  return Engine.getPinfallSummary(state.players[key]).kickout;
}

function makeState(options = {}) {
  const playerHandIds = options.playerHandIds || [];
  const enemyHandIds = options.enemyHandIds || [];
  // Keep decks deep enough so draw phases never end the match mid-test.
  const playerDeckIds = options.playerDeckIds || Array(20).fill("dodge");
  const enemyDeckIds = options.enemyDeckIds || Array(20).fill("dodge");

  const playerHand = playerHandIds.map((id, index) => cardClone(id, `ph${index}`));
  const enemyHand = enemyHandIds.map((id, index) => cardClone(id, `eh${index}`));
  const playerDeck = playerDeckIds.map((id, index) => cardClone(id, `pd${index}`));
  const enemyDeck = enemyDeckIds.map((id, index) => cardClone(id, `ed${index}`));

  const state = Engine.createMatch({
    initiativeWinner: "player",
    random: options.random || [],
    player: {
      name: "Player",
      maneuverDeck: playerDeck,
      hand: playerHand,
      pinfallDeck: options.playerPinfallDeck || undefined
    },
    enemy: {
      name: "Enemy",
      maneuverDeck: enemyDeck,
      hand: enemyHand,
      pinfallDeck: options.enemyPinfallDeck || undefined
    }
  });

  if (options.playerStunned !== undefined) {
    state.players.player.stunned = Boolean(options.playerStunned);
  }
  if (options.enemyStunned !== undefined) {
    state.players.enemy.stunned = Boolean(options.enemyStunned);
  }
  if (options.nextSlot) {
    state.turn.nextSlot = options.nextSlot;
  }
  return state;
}

function playPlayerCard(state, handIndex = 0) {
  Engine.playOffensiveCard(state, handIndex, "player");
}

function forceNoDefence(state) {
  if (state.resolution?.awaitingDefenceChoice) {
    Engine.chooseNoDefence(state);
  }
}

function forceDodgeSuccess(state, enemyHandIndex = 0) {
  Engine.prepareDefence(state, enemyHandIndex);
  Engine.callDefenceCoin(state, "Heads");
}

const verifyByCardId = {
  "450_splash": () => {
    const state = makeState({ playerHandIds: ["450_splash"] });
    const start = failCount(state, "enemy");
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(failCount(state, "enemy")).toBe(start + 1);
  },
  air_guitar: () => {
    const state = makeState({ playerHandIds: ["air_guitar", "suplex"] });
    const deckStart = state.players.player.maneuverDeck.length;
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(state.players.player.maneuverDeck.length).toBe(deckStart - 1);
  },
  body_blow: () => {
    const state = makeState({ playerHandIds: ["body_blow"], nextSlot: 1 });
    const deckStart = state.players.player.maneuverDeck.length;
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(state.players.player.maneuverDeck.length).toBe(deckStart - 1);
  },
  chop: () => {
    const state = makeState({ playerHandIds: ["chop"], nextSlot: 1 });
    const deckStart = state.players.player.maneuverDeck.length;
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(state.players.player.maneuverDeck.length).toBe(deckStart - 1);
  },
  armbar: () => {
    const state = makeState({ playerHandIds: ["armbar"] });
    const koStart = kickoutCount(state, "player");
    const failStart = failCount(state, "enemy");
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(kickoutCount(state, "player")).toBe(koStart + 1);
    expect(failCount(state, "enemy")).toBe(failStart);
  },
  bear_hug: () => {
    const state = makeState({ playerHandIds: ["bear_hug"] });
    const koStart = kickoutCount(state, "player");
    const failStart = failCount(state, "enemy");
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(kickoutCount(state, "player")).toBe(koStart + 1);
    expect(failCount(state, "enemy")).toBe(failStart);
  },
  chair_shot: () => {
    const state = makeState({
      random: [...Array(45).fill(0.499), 0.1, 0.75],
      playerHandIds: ["chair_shot"],
      enemyHandIds: ["dodge"]
    });
    const startFails = failCount(state, "player");
    playPlayerCard(state, 0);
    forceDodgeSuccess(state, 0);
    expect(failCount(state, "player")).toBe(startFails + 2);

    const state2 = makeState({ playerHandIds: ["chair_shot"], enemyPinfallDeck: ["Fail", "Fail", "Kickout"] });
    const koBefore = kickoutCount(state2, "player");
    state2.players.enemy.hand = [];
    playPlayerCard(state2, 0);
    forceNoDefence(state2);
    expect(state2.players.enemy.stunned).toBeTruthy();
    expect(kickoutCount(state2, "player")).toBe(koBefore + 1);
    expect(state2.phase).not.toBe(Engine.PHASES.PINFALL_DRAW);
  },
  cheap_shot: () => {
    const state = makeState({ playerHandIds: ["cheap_shot"], enemyHandIds: ["jab", "suplex"] });
    const handStart = state.players.enemy.hand.length;
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(state.players.enemy.hand.length).toBe(handStart - 1);
  },
  chokeslam: () => {
    const state = makeState({ playerHandIds: ["chokeslam"] });
    state.players.enemy.hand = [];
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(state.phase).toBe(Engine.PHASES.PINFALL_DRAW);
    expect(state.pinAttempt).not.toBeNull();
  },
  clothesline: () => {
    const state = makeState({
      random: [...Array(45).fill(0.499), 0.05, 0.95, 0.55],
      playerHandIds: ["clothesline"],
      enemyHandIds: ["dodge"]
    });
    playPlayerCard(state, 0);
    Engine.prepareDefence(state, 0);
    expect(state.resolution.defence.coinMode).toBe("normal");
    Engine.callDefenceCoin(state, "Heads");
    expect(state.lastDefenceRoll.attackerUsedDisadvantage).toBe(true);
  },
  complain_to_ref: () => {
    const state = makeState({
      random: [0.95, 0.05],
      playerHandIds: ["complain_to_ref"]
    });
    const koStart = kickoutCount(state, "player");
    const failStart = failCount(state, "player");
    playPlayerCard(state, 0);
    forceNoDefence(state);
    const koGain = kickoutCount(state, "player") - koStart;
    const failGain = failCount(state, "player") - failStart;
    // Either branch of the D20 contest should apply.
    expect(koGain === 1 || failGain === 2).toBeTruthy();
  },
  dropkick: () => {
    const state = makeState({ playerHandIds: ["dropkick"], nextSlot: 3 });
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(state.players.enemy.damage).toBe(6);
  },
  eye_rake: () => {
    const state = makeState({ playerHandIds: ["eye_rake"] });
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(state.players.enemy.stunned).toBeTruthy();
  },
  figure_four: () => {
    const state = makeState({ playerHandIds: ["figure_four"], nextSlot: 3 });
    const failBefore = failCount(state, "enemy");
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(state.log.filter((entry) => entry.includes("roll-off")).length).toBe(3);
    const gained = failCount(state, "enemy") - failBefore;
    expect(gained).toBeGreaterThanOrEqual(0);
    expect(gained).toBeLessThanOrEqual(3);
  },
  frog_splash: () => {
    const state = makeState({
      playerHandIds: ["shush", "frog_splash"],
      enemyHandIds: ["dodge"],
      nextSlot: 1
    });
    playPlayerCard(state, 0);
    forceNoDefence(state);
    playPlayerCard(state, 0);
    Engine.prepareDefence(state, 0);
    expect(state.resolution.defence.coinMode).toBe("disadvantage");
  },
  elbow_drop: () => {
    const state = makeState({
      playerHandIds: ["shush", "elbow_drop"],
      enemyHandIds: ["dodge"],
      nextSlot: 1
    });
    playPlayerCard(state, 0);
    forceNoDefence(state);
    playPlayerCard(state, 0);
    Engine.prepareDefence(state, 0);
    expect(state.resolution.defence.coinMode).toBe("disadvantage");
  },
  second_rope_elbow_drop: () => {
    const state = makeState({
      playerHandIds: ["irish_whip", "irish_whip", "second_rope_elbow_drop"],
      enemyHandIds: ["dodge"],
      nextSlot: 1
    });
    playPlayerCard(state, 0);
    forceNoDefence(state);
    playPlayerCard(state, 0);
    forceNoDefence(state);
    playPlayerCard(state, 0);
    Engine.prepareDefence(state, 0);
    expect(state.resolution.defence.coinMode).toBe("disadvantage");
  },
  fwahhh: () => {
    const state = makeState({
      playerHandIds: ["fwahhh", "jab"],
      enemyHandIds: ["suplex", "jab"]
    });
    const playerStart = state.players.player.hand.length;
    const enemyStart = state.players.enemy.hand.length;
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(state.players.player.hand.length).toBe(playerStart - 2);
    expect(state.players.enemy.hand.length).toBe(enemyStart - 1);
  },
  german_suplex: () => {
    const state = makeState({ playerHandIds: ["german_suplex"], nextSlot: 2 });
    const start = failCount(state, "enemy");
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(failCount(state, "enemy")).toBe(start + 1);
  },
  get_hyped: () => {
    const state = makeState({ playerHandIds: ["get_hyped"], playerStunned: true });
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(state.players.player.stunned).toBeFalsy();
  },
  gun_show: () => {
    const state = makeState({
      random: [0.95, 0.05],
      playerHandIds: ["gun_show", "suplex"],
      nextSlot: 1
    });
    const enemyHandStart = state.players.enemy.hand.length;
    playPlayerCard(state, 0);
    forceNoDefence(state);
    playPlayerCard(state, 0);
    forceNoDefence(state);
    // Attacker-win branch gives +1 damage; defender-win branch draws 1 for defender.
    expect(state.players.enemy.damage === 4 || state.players.enemy.hand.length === enemyHandStart + 1).toBeTruthy();
  },
  gyrate_hips: () => {
    const state = makeState({
      playerHandIds: ["jab", "gyrate_hips"],
      nextSlot: 1
    });
    const start = kickoutCount(state, "player");
    playPlayerCard(state, 0);
    forceNoDefence(state);
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(kickoutCount(state, "player")).toBe(start + 2);
  },
  headbutt: () => {
    const state = makeState({ playerHandIds: ["headbutt"], nextSlot: 2 });
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(state.players.player.damage).toBe(3);
  },
  hulk_up: () => {
    const state = makeState({
      playerHandIds: ["hulk_up", "suplex"],
      nextSlot: 1
    });
    playPlayerCard(state, 0);
    forceNoDefence(state);
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(state.players.enemy.damage).toBe(5);
  },
  irish_whip: () => {
    const state = makeState({ playerHandIds: ["irish_whip", "suplex"], nextSlot: 1 });
    playPlayerCard(state, 0);
    forceNoDefence(state);
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(state.players.enemy.damage).toBe(5);
  },
  jab: () => {
    const state = makeState({ playerHandIds: ["jab", "suplex"], nextSlot: 1 });
    playPlayerCard(state, 0);
    forceNoDefence(state);
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(state.players.enemy.damage).toBe(5);
  },
  low_blow: () => {
    const state = makeState({ playerHandIds: ["low_blow"], enemyHandIds: ["jab", "suplex"], nextSlot: 2 });
    const enemyStart = state.players.enemy.hand.length;
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(state.players.enemy.stunned).toBeTruthy();
    expect(state.players.enemy.hand.length).toBe(enemyStart);
  },
  powerbomb: () => {
    const state = makeState({ playerHandIds: ["powerbomb"], nextSlot: 3 });
    const start = failCount(state, "enemy");
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(failCount(state, "enemy")).toBe(start + 1);
  },
  ref_distraction: () => {
    const state = makeState({
      random: [0.1, 0.75],
      playerHandIds: ["ref_distraction", "low_blow"],
      enemyHandIds: ["dodge"],
      nextSlot: 1
    });
    const failStart = failCount(state, "player");
    playPlayerCard(state, 0);
    Engine.chooseNoDefence(state);
    state.players.enemy.hand.push(cardClone("dodge", "enemy_readd"));
    playPlayerCard(state, 0);
    forceDodgeSuccess(state, 0);
    expect(failCount(state, "player")).toBe(failStart);
    expect(state.players.enemy.stunned).toBeTruthy();
  },
  roar: () => {
    const state = makeState({ playerHandIds: ["roar", "suplex"], nextSlot: 2 });
    playPlayerCard(state, 0);
    forceNoDefence(state);
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(state.players.enemy.damage).toBe(5);
  },
  sharpshooter: () => {
    const state = makeState({ playerHandIds: ["sharpshooter"], enemyHandIds: ["jab", "suplex"], nextSlot: 3 });
    const enemyStart = state.players.enemy.hand.length;
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(state.players.enemy.stunned).toBeTruthy();
    expect(state.players.enemy.hand.length).toBe(enemyStart - 1);
  },
  shush: () => {
    const state = makeState({ playerHandIds: ["shush", "suplex"], nextSlot: 1 });
    playPlayerCard(state, 0);
    forceNoDefence(state);
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(state.players.enemy.damage).toBe(4);
  },
  shooting_star_press: () => {
    const state = makeState({ playerHandIds: ["shooting_star_press"], nextSlot: 3 });
    state.players.enemy.hand = [];
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(state.phase).toBe(Engine.PHASES.PINFALL_DRAW);
    expect(state.pinAttempt).not.toBeNull();
  },
  sleeper_hold: () => {
    const state = makeState({ playerHandIds: ["sleeper_hold"], nextSlot: 2 });
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(state.players.enemy.stunned).toBeFalsy();
  },
  spear: () => {
    const state = makeState({ playerHandIds: ["spear"], nextSlot: 1 });
    state.players.enemy.hand = [];
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(state.phase).toBe(Engine.PHASES.PINFALL_DRAW);
    expect(state.pinAttempt).not.toBeNull();
  },
  strut: () => {
    const state = makeState({ playerHandIds: ["strut"], nextSlot: 3 });
    const start = kickoutCount(state, "player");
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(kickoutCount(state, "player")).toBe(start + 1);
  },
  suplex: () => {
    const state = makeState({ playerHandIds: ["suplex"], nextSlot: 2 });
    const start = failCount(state, "enemy");
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(failCount(state, "enemy")).toBe(start + 1);
  },
  super_kick: () => {
    const state = makeState({ playerHandIds: ["super_kick"], nextSlot: 3 });
    state.players.enemy.hand = [];
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(state.phase).toBe(Engine.PHASES.PINFALL_DRAW);
    expect(state.pinAttempt).not.toBeNull();
  },
  trip: () => {
    const state = makeState({ playerHandIds: ["trip"], enemyHandIds: ["suplex", "jab"], nextSlot: 1 });
    const enemyStart = state.players.enemy.hand.length;
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(state.players.enemy.hand.length).toBe(enemyStart - 1);
  },
  wild_swing: () => {
    const state = makeState({
      random: [0.02, 0.95],
      playerHandIds: ["irish_whip", "wild_swing"],
      enemyHandIds: ["dodge"],
      playerPinfallDeck: [...FIXED_PINFALL_DECK],
      enemyPinfallDeck: [...FIXED_PINFALL_DECK],
      nextSlot: 1
    });
    playPlayerCard(state, 0);
    forceNoDefence(state);
    playPlayerCard(state, 0);
    forceDodgeSuccess(state, 0);
    expect(state.players.player.stunned).toBeTruthy();
  },
  yell_at_crowd: () => {
    const state = makeState({
      playerHandIds: ["yell_at_crowd", "suplex"],
      enemyHandIds: ["jab", "suplex"],
      nextSlot: 2
    });
    const playerStart = state.players.player.hand.length;
    const enemyStart = state.players.enemy.hand.length;
    playPlayerCard(state, 0);
    forceNoDefence(state);
    expect(state.players.player.hand.length).toBe(playerStart - 2);
    expect(state.players.enemy.hand.length).toBe(enemyStart - 1);
  }
};

for (const cardId of EFFECT_CARD_IDS) {
  test(`card effect works in match: ${cardId}`, () => {
    const verify = verifyByCardId[cardId];
    expect(verify, `Missing effect verifier for ${cardId}`).toBeTruthy();
    verify();
  });
}
