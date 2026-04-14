const GAME_WIDTH = 1100;
const GAME_HEIGHT = 720;
const HAND_SIZE = 6;
const CARD_WIDTH = 144;
const CARD_HEIGHT = 186;
const CARD_GAP = 12;
const HP_BAR_WIDTH = 380;
const HP_BAR_HEIGHT = 24;
const ENEMY_TURN_DELAY = 850;
const PIN_DRAW_DELAY = 650;
const DAMAGE_PER_FAIL = 10;
const PIN_DRAW_COUNT = 3;
const STARTING_PIN_FAILS = 3;
const STARTING_PIN_KICKOUTS = 7;
const ENEMY_PIN_CHANCE = 0.35;

const COLORS = {
  paper: 0xe3d4bf,
  posterYellow: 0xf1c525,
  cream: 0xffe59e,
  magenta: 0xdf347d,
  deepMagenta: 0xa91f59,
  cyan: 0x0f84a5,
  cyanLight: 0x42b9d7,
  ink: 0x111111,
  brownInk: 0x312519,
  mutedYellow: 0xcdb77c,
  mutedBlue: 0x7aa0ab,
  dangerPink: 0xda3a64,
  warningOrange: 0xf09a2a,
  healthCyan: 0x12a6c8
};

const PLAYER_TEMPLATE = {
  name: "The Rookie",
  maxHp: 50
};

const ENEMY_TEMPLATE = {
  name: '"Iron Jaw" Briggs',
  maxHp: 60
};

// The main deck now mixes attacks and pin cards, but it still lives inline for easy tweaking.
const STARTER_DECK_TEMPLATE = [
  { type: "attack", name: "Chop", damage: 6 },
  { type: "attack", name: "Chop", damage: 6 },
  {
    type: "attack",
    name: "Cheap Shot",
    damage: 5,
    effects: [{ type: "pinfall", card: "Fail", target: "opponent", amount: 1 }]
  },
  { type: "attack", name: "Dropkick", damage: 8 },
  { type: "attack", name: "Dropkick", damage: 8 },
  {
    type: "attack",
    name: "Fighting Spirit",
    damage: 4,
    effects: [{ type: "pinfall", card: "Kickout", target: "self", amount: 1 }]
  },
  { type: "attack", name: "Clothesline", damage: 10 },
  { type: "attack", name: "Clothesline", damage: 10 },
  { type: "attack", name: "Clothesline", damage: 10 },
  { type: "attack", name: "Suplex", damage: 12 },
  { type: "attack", name: "Suplex", damage: 12 },
  { type: "attack", name: "Suplex", damage: 12 },
  { type: "attack", name: "Big Boot", damage: 14 },
  { type: "attack", name: "Big Boot", damage: 14 },
  { type: "pin", name: "Cover" },
  { type: "pin", name: "Lateral Press" },
  { type: "pin", name: "Schoolboy" }
];

const ENEMY_ATTACKS = [
  { name: "Body Slam", damage: 7 },
  { name: "Elbow Smash", damage: 8 },
  { name: "Running Knee", damage: 9 },
  { name: "Backbreaker", damage: 10 },
  { name: "Powerbomb", damage: 12 }
];

const ENEMY_PIN_MOVES = [
  { name: "Hooked Leg Cover" },
  { name: "Lateral Press" },
  { name: "Cradle Pin" }
];

// Phaser handles rendering and input inside one scene, which is still enough for V2.
const phaserConfig = {
  type: Phaser.AUTO,
  parent: "game",
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: "#e3d4bf",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: {
    key: "UnderCardMatch",
    create
  }
};

const game = new Phaser.Game(phaserConfig);
const restartButton = document.getElementById("restart-button");
const dom = {
  matchLogList: document.getElementById("match-log-list"),
  matchLogPanel: document.getElementById("match-log"),
  enemyPinfallSummary: document.getElementById("enemy-pinfall-summary"),
  enemyPinfallCards: document.getElementById("enemy-pinfall-cards"),
  playerPinfallSummary: document.getElementById("player-pinfall-summary"),
  playerPinfallCards: document.getElementById("player-pinfall-cards")
};

restartButton.addEventListener("click", restartMatch);

function create() {
  this.state = createMatchState();

  // The whole prototype still lives in one scene, so we build the UI once up front.
  createBackdrop(this);
  createMatchPanel(this);
  createStatusPanel(this);
  createHandZone(this);
  createOutcomeBanner(this);

  startMatch(this);
}

function createMatchState() {
  return {
    deck: [],
    hand: [],
    player: createWrestlerState(PLAYER_TEMPLATE),
    enemy: createWrestlerState(ENEMY_TEMPLATE),
    currentTurn: "player",
    isGameOver: false,
    isResolvingPin: false,
    pinAttempt: null,
    outcome: null,
    statusMessage: "Bell rings. Your turn.",
    matchLog: [],
    shouldScrollLog: false,
    pinLogLines: [
      `Pinfall decks start at ${STARTING_PIN_FAILS} Fail / ${STARTING_PIN_KICKOUTS} Kickout.`
    ],
    enemyNameText: null,
    enemyHpText: null,
    enemyDamageText: null,
    enemyPinDeckText: null,
    enemyPinMixText: null,
    playerNameText: null,
    playerHpText: null,
    playerDamageText: null,
    playerPinDeckText: null,
    playerPinMixText: null,
    drawPileText: null,
    turnText: null,
    statusText: null,
    pinText: null,
    handContainer: null,
    enemyHpFill: null,
    playerHpFill: null,
    outcomeText: null
  };
}

function createWrestlerState(template) {
  return {
    name: template.name,
    hp: template.maxHp,
    maxHp: template.maxHp,
    accumulatedDamage: 0,
    failCardsFromDamage: 0,
    pinfallDeck: buildPinfallDeck()
  };
}

function startMatch(scene) {
  const { state } = scene;

  state.deck = buildShuffledDeck();
  state.hand = [];
  state.player = createWrestlerState(PLAYER_TEMPLATE);
  state.enemy = createWrestlerState(ENEMY_TEMPLATE);
  state.currentTurn = "player";
  state.isGameOver = false;
  state.isResolvingPin = false;
  state.pinAttempt = null;
  state.outcome = null;
  state.statusMessage = "Bell rings. Your turn.";
  state.matchLog = [];
  state.shouldScrollLog = false;
  state.pinLogLines = [
    `Pinfall decks start at ${STARTING_PIN_FAILS} Fail / ${STARTING_PIN_KICKOUTS} Kickout.`
  ];

  // Start with a full hand so the first turn feels immediate.
  drawCards(scene, HAND_SIZE);
  addMatchLog(scene, `${state.player.name} vs ${state.enemy.name}.`);
  addMatchLog(
    scene,
    `Main deck and pinfall deck are separate. Each pinfall deck starts at ${STARTING_PIN_FAILS} Fail / ${STARTING_PIN_KICKOUTS} Kickout.`
  );
  addMatchLog(scene, "Bell rings. Your turn.");
  renderScene(scene);
}

function buildShuffledDeck() {
  const deck = STARTER_DECK_TEMPLATE.map((card) => ({ ...card }));
  return shuffleArray(deck);
}

function buildPinfallDeck() {
  const deck = [];

  // Each wrestler begins with a basic pinfall mix before damage makes the deck scarier.
  for (let index = 0; index < STARTING_PIN_FAILS; index += 1) {
    deck.push("Fail");
  }

  for (let index = 0; index < STARTING_PIN_KICKOUTS; index += 1) {
    deck.push("Kickout");
  }

  return shuffleArray(deck);
}

function shuffleArray(items) {
  // Fisher-Yates swaps each slot with a random earlier slot for an even shuffle.
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }

  return items;
}

function drawCards(scene, amount) {
  const { deck, hand } = scene.state;

  // Drawing from the end means each draw is just a simple pop from the deck array.
  for (let count = 0; count < amount; count += 1) {
    if (deck.length === 0) {
      return;
    }

    hand.push(deck.pop());
  }
}

function playCard(scene, handIndex) {
  const { state } = scene;

  if (state.isGameOver || state.isResolvingPin || state.currentTurn !== "player") {
    return;
  }

  // Splice removes the card from the hand data so the UI and game state stay aligned.
  const [playedCard] = state.hand.splice(handIndex, 1);

  if (!playedCard) {
    return;
  }

  drawCards(scene, 1);

  if (playedCard.type === "pin") {
    state.statusMessage = `${state.player.name} goes for ${playedCard.name}!`;
    startPinAttempt(scene, "player", "enemy", playedCard.name);
    return;
  }

  const result = applyAttackDamage(scene, "enemy", playedCard.damage);
  const effectMessages = resolveCardEffects(scene, "player", "enemy", playedCard.effects);

  if (state.enemy.hp <= 0) {
    endMatch(scene, "win", `${playedCard.name} lands flush for ${playedCard.damage}. You win.`);
    return;
  }

  state.currentTurn = "enemy";
  state.statusMessage = buildAttackMessage(
    state.player.name,
    playedCard.name,
    playedCard.damage,
    state.enemy.name,
    result.failCardsAdded,
    effectMessages
  );
  addMatchLog(scene, state.statusMessage);

  if (result.failCardsAdded > 0 || effectMessages.length > 0) {
    updateDeckChangeLog(scene, "enemy", result.failCardsAdded, effectMessages);
  }
  renderScene(scene);
  scheduleEnemyTurn(scene);
}

function scheduleEnemyTurn(scene) {
  scene.time.delayedCall(ENEMY_TURN_DELAY, () => {
    runEnemyTurn(scene);
  });
}

function runEnemyTurn(scene) {
  const { state } = scene;

  if (state.isGameOver || state.isResolvingPin) {
    return;
  }

  if (shouldEnemyAttemptPin(scene)) {
    const pinMove = pickRandom(ENEMY_PIN_MOVES);
    state.statusMessage = `${state.enemy.name} goes for ${pinMove.name}!`;
    startPinAttempt(scene, "enemy", "player", pinMove.name);
    return;
  }

  const enemyAttack = pickRandom(ENEMY_ATTACKS);
  const result = applyAttackDamage(scene, "player", enemyAttack.damage);
  const effectMessages = resolveCardEffects(scene, "enemy", "player", enemyAttack.effects);

  if (state.player.hp <= 0) {
    endMatch(
      scene,
      "lose",
      `${state.enemy.name} hits ${enemyAttack.name} for ${enemyAttack.damage}. You lose.`
    );
    return;
  }

  state.currentTurn = "player";
  state.statusMessage = buildAttackMessage(
    state.enemy.name,
    enemyAttack.name,
    enemyAttack.damage,
    state.player.name,
    result.failCardsAdded,
    effectMessages
  );
  addMatchLog(scene, state.statusMessage);

  if (result.failCardsAdded > 0 || effectMessages.length > 0) {
    updateDeckChangeLog(scene, "player", result.failCardsAdded, effectMessages);
  }
  renderScene(scene);
}

function shouldEnemyAttemptPin(scene) {
  const { player } = scene.state;
  return player.accumulatedDamage >= DAMAGE_PER_FAIL && Math.random() < ENEMY_PIN_CHANCE;
}

function pickRandom(list) {
  const itemIndex = Math.floor(Math.random() * list.length);
  return list[itemIndex];
}

function applyAttackDamage(scene, targetKey, damage) {
  const target = scene.state[targetKey];

  target.hp = Math.max(0, target.hp - damage);
  target.accumulatedDamage += damage;

  return {
    failCardsAdded: addFailCardsFromDamage(target)
  };
}

function resolveCardEffects(scene, ownerKey, opponentKey, effects = []) {
  const messages = [];

  effects.forEach((effect) => {
    if (effect.type !== "pinfall") {
      return;
    }

    const receiverKey = effect.target === "self" ? ownerKey : opponentKey;
    addCardsToPinfallDeck(scene.state[receiverKey], effect.card, effect.amount);

    messages.push(
      `${scene.state[receiverKey].name} gains ${effect.amount} ${effect.card} ${pluralize(
        "card",
        effect.amount
      )} in the pinfall deck.`
    );
  });

  return messages;
}

function addFailCardsFromDamage(wrestler) {
  // Every full damage threshold injects another Fail card into the pinfall deck.
  const failCardsEarned = Math.floor(wrestler.accumulatedDamage / DAMAGE_PER_FAIL);
  const failCardsToAdd = failCardsEarned - wrestler.failCardsFromDamage;

  if (failCardsToAdd <= 0) {
    return 0;
  }

  for (let index = 0; index < failCardsToAdd; index += 1) {
    wrestler.pinfallDeck.push("Fail");
  }

  wrestler.failCardsFromDamage = failCardsEarned;

  // Shuffle so the new danger matters right away instead of sitting at one end of the deck.
  shuffleArray(wrestler.pinfallDeck);
  return failCardsToAdd;
}

function addCardsToPinfallDeck(wrestler, cardType, amount) {
  // Card effects seed extra Fail or Kickout cards into the separate pinfall deck.
  for (let index = 0; index < amount; index += 1) {
    wrestler.pinfallDeck.push(cardType);
  }

  shuffleArray(wrestler.pinfallDeck);
}

function addMatchLog(scene, message) {
  if (!message) {
    return;
  }

  scene.state.matchLog.push(message);
  scene.state.shouldScrollLog = true;
}

function addMatchLogLines(scene, messages) {
  messages.forEach((message) => {
    addMatchLog(scene, message);
  });
}

function startPinAttempt(scene, attackerKey, defenderKey, pinName) {
  const { state } = scene;

  state.isResolvingPin = true;
  state.pinAttempt = {
    attackerKey,
    defenderKey,
    pinName,
    drawnCards: []
  };
  state.pinLogLines = [
    `${state[attackerKey].name} uses ${pinName}.`,
    `${state[defenderKey].name} draws ${PIN_DRAW_COUNT} from the pinfall deck.`
  ];
  addMatchLogLines(scene, state.pinLogLines);

  renderScene(scene);

  scene.time.delayedCall(PIN_DRAW_DELAY, () => {
    resolveNextPinDraw(scene);
  });
}

function resolveNextPinDraw(scene) {
  const { state } = scene;
  const attempt = state.pinAttempt;

  if (state.isGameOver || !attempt) {
    return;
  }

  const defender = state[attempt.defenderKey];
  const drawnCard = defender.pinfallDeck.pop();
  const drawLine = `Count ${attempt.drawnCards.length + 1}: ${drawnCard}`;

  attempt.drawnCards.push(drawnCard);
  addMatchLog(scene, drawLine);

  if (drawnCard === "Kickout") {
    addMatchLog(scene, `Kickout at ${attempt.drawnCards.length}!`);
    state.pinLogLines = buildPinLogLines(scene, attempt, `Kickout at ${attempt.drawnCards.length}!`);
    renderScene(scene);

    scene.time.delayedCall(PIN_DRAW_DELAY, () => {
      finishFailedPin(scene);
    });
    return;
  }

  if (attempt.drawnCards.length >= PIN_DRAW_COUNT) {
    addMatchLog(scene, "Three straight Fail cards. The pin holds.");
    state.pinLogLines = buildPinLogLines(scene, attempt, "Three straight Fail cards. The pin holds.");
    renderScene(scene);

    scene.time.delayedCall(PIN_DRAW_DELAY, () => {
      finishSuccessfulPin(scene);
    });
    return;
  }

  state.pinLogLines = buildPinLogLines(scene, attempt);
  renderScene(scene);

  scene.time.delayedCall(PIN_DRAW_DELAY, () => {
    resolveNextPinDraw(scene);
  });
}

function buildPinLogLines(scene, attempt, footerText) {
  const lines = [`${scene.state[attempt.attackerKey].name} uses ${attempt.pinName}.`];

  attempt.drawnCards.forEach((card, index) => {
    lines.push(`Count ${index + 1}: ${card}`);
  });

  if (footerText) {
    lines.push(footerText);
  }

  return lines;
}

function finishFailedPin(scene) {
  const { state } = scene;
  const attempt = state.pinAttempt;

  if (!attempt) {
    return;
  }

  const defender = state[attempt.defenderKey];

  // On a kickout, the revealed cards go back so the next pin uses the full damaged deck again.
  defender.pinfallDeck.push(...attempt.drawnCards);
  shuffleArray(defender.pinfallDeck);

  state.isResolvingPin = false;
  state.pinAttempt = null;
  state.statusMessage = `${defender.name} kicks out at ${attempt.drawnCards.length}!`;
  addMatchLog(scene, `${defender.name}'s drawn pin cards return to the pinfall deck and it shuffles.`);

  if (attempt.attackerKey === "player") {
    state.currentTurn = "enemy";
    renderScene(scene);
    scheduleEnemyTurn(scene);
    return;
  }

  state.currentTurn = "player";
  renderScene(scene);
}

function finishSuccessfulPin(scene) {
  const { state } = scene;
  const attempt = state.pinAttempt;

  if (!attempt) {
    return;
  }

  const attacker = state[attempt.attackerKey];

  state.isResolvingPin = false;
  state.pinAttempt = null;

  endMatch(
    scene,
    attempt.attackerKey === "player" ? "win" : "lose",
    `${attacker.name} gets the three-count with ${attempt.pinName}!`
  );
}

function buildAttackMessage(attackerName, moveName, damage, targetName, failCardsAdded, effectMessages) {
  let message = `${attackerName} hits ${moveName} for ${damage} damage on ${targetName}.`;

  if (failCardsAdded > 0) {
    message += ` ${failCardsAdded} ${pluralize("Fail card", failCardsAdded)} added from damage.`;
  }

  if (effectMessages.length > 0) {
    message += ` ${effectMessages.join(" ")}`;
  }

  return message;
}

function updateDeckChangeLog(scene, targetKey, failCardsAdded, effectMessages) {
  const target = scene.state[targetKey];
  const lines = [];

  if (failCardsAdded > 0) {
    lines.push(`${target.name} took ${target.accumulatedDamage} total damage.`);
    lines.push(
      `${failCardsAdded} ${pluralize("Fail card", failCardsAdded)} added from the damage threshold.`
    );
  }

  lines.push(...effectMessages);

  if (lines.length === 0) {
    return;
  }

  if (failCardsAdded > 0) {
    lines.push(`Another Fail arrives every ${DAMAGE_PER_FAIL} damage.`);
  }

  scene.state.pinLogLines = lines;
  addMatchLogLines(scene, lines);
}

function pluralize(word, count) {
  return count === 1 ? word : `${word}s`;
}

function endMatch(scene, outcome, message) {
  scene.state.outcome = outcome;
  scene.state.isGameOver = true;
  scene.state.isResolvingPin = false;
  scene.state.pinAttempt = null;
  scene.state.statusMessage = message;
  addMatchLog(scene, message);
  renderScene(scene);
}

function renderScene(scene) {
  updateMatchPanel(scene);
  updateStatusPanel(scene);
  renderHand(scene);
  updateOutcomeBanner(scene);
  updateInspectorPanels(scene);
}

function createBackdrop(scene) {
  const bg = scene.add.graphics();

  bg.fillStyle(COLORS.paper, 1);
  bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

  bg.fillStyle(COLORS.ink, 1);
  bg.fillRect(46, 34, GAME_WIDTH - 90, GAME_HEIGHT - 68);

  bg.fillStyle(COLORS.posterYellow, 1);
  bg.fillRect(30, 18, GAME_WIDTH - 90, GAME_HEIGHT - 68);

  bg.fillStyle(COLORS.magenta, 1);
  bg.fillRect(30, 18, 58, GAME_HEIGHT - 68);

  bg.fillStyle(COLORS.cyan, 1);
  bg.fillRect(96, 126, GAME_WIDTH - 210, 6);

  drawPaperSpeckles(bg, 30, 18, GAME_WIDTH - 90, GAME_HEIGHT - 68, 700);

  // A duplicated title sells the misregistered print-box look from the reference.
  scene.add.text(114, 40, "UNDERCARD", {
    fontFamily: "Impact, Arial Black, sans-serif",
    fontSize: "78px",
    color: "#0f84a5"
  });

  scene.add.text(108, 34, "UNDERCARD", {
    fontFamily: "Impact, Arial Black, sans-serif",
    fontSize: "78px",
    color: "#df347d"
  });

  scene.add.text(110, 96, "Pins, kickouts, and damage-loaded pinfall decks.", {
    fontFamily: "Arial Narrow, Trebuchet MS, sans-serif",
    fontSize: "19px",
    color: "#312519",
    fontStyle: "bold"
  });
}

function drawPaperSpeckles(graphics, x, y, width, height, count) {
  // Tiny dots break up the flat colors so the board feels more printed than digital.
  for (let index = 0; index < count; index += 1) {
    const dotX = x + Math.random() * width;
    const dotY = y + Math.random() * height;
    const dotSize = Math.random() > 0.9 ? 2 : 1;
    const dotColor = Math.random() > 0.7 ? COLORS.brownInk : COLORS.cream;
    const dotAlpha = dotColor === COLORS.brownInk ? 0.08 : 0.06;

    graphics.fillStyle(dotColor, dotAlpha);
    graphics.fillRect(dotX, dotY, dotSize, dotSize);
  }
}

function createMatchPanel(scene) {
  scene.add.rectangle(90, 146, 940, 194, COLORS.cyan, 1).setOrigin(0);

  const panel = scene.add.rectangle(80, 136, 940, 194, COLORS.posterYellow, 1).setOrigin(0);
  panel.setStrokeStyle(6, COLORS.ink);

  scene.add.rectangle(548, 156, 6, 146, COLORS.ink, 1).setOrigin(0);

  createWrestlerColumn(scene, "enemy", 112);
  createWrestlerColumn(scene, "player", 584);
}

function createWrestlerColumn(scene, wrestlerKey, x) {
  const label = wrestlerKey === "enemy" ? "OPPONENT" : "PLAYER";
  const isEnemy = wrestlerKey === "enemy";

  scene.add.text(x, 156, label, {
    fontFamily: "Arial Narrow, Trebuchet MS, sans-serif",
    fontSize: "18px",
    color: "#df347d",
    fontStyle: "bold"
  });

  scene.state[`${wrestlerKey}NameText`] = scene.add.text(x, 178, "", {
    fontFamily: "Impact, Arial Black, sans-serif",
    fontSize: isEnemy ? "31px" : "29px",
    color: "#111111"
  });

  scene.state[`${wrestlerKey}HpText`] = scene.add.text(x, 214, "", {
    fontFamily: "Arial Narrow, Trebuchet MS, sans-serif",
    fontSize: "19px",
    color: "#312519",
    fontStyle: "bold"
  });

  scene.state[`${wrestlerKey}DamageText`] = scene.add.text(x, 236, "", {
    fontFamily: "Arial Narrow, Trebuchet MS, sans-serif",
    fontSize: "19px",
    color: "#312519",
    fontStyle: "bold"
  });

  scene.state[`${wrestlerKey}PinDeckText`] = scene.add.text(x, 260, "", {
    fontFamily: "Arial Narrow, Trebuchet MS, sans-serif",
    fontSize: "18px",
    color: "#111111",
    fontStyle: "bold"
  });

  scene.state[`${wrestlerKey}PinMixText`] = scene.add.text(x, 282, "", {
    fontFamily: "Arial Narrow, Trebuchet MS, sans-serif",
    fontSize: "18px",
    color: "#111111",
    fontStyle: "bold"
  });

  scene.add.rectangle(x, 304, HP_BAR_WIDTH, HP_BAR_HEIGHT, COLORS.ink, 1).setOrigin(0);
  scene.state[`${wrestlerKey}HpFill`] = scene.add.graphics();
}

function createStatusPanel(scene) {
  scene.add.rectangle(90, 356, 940, 106, COLORS.magenta, 1).setOrigin(0);

  const panel = scene.add.rectangle(80, 346, 940, 106, COLORS.posterYellow, 1).setOrigin(0);
  panel.setStrokeStyle(6, COLORS.ink);

  scene.add.rectangle(666, 360, 4, 78, COLORS.ink, 1).setOrigin(0);

  scene.add.text(112, 360, "MATCH LOG", {
    fontFamily: "Arial Narrow, Trebuchet MS, sans-serif",
    fontSize: "17px",
    color: "#df347d",
    fontStyle: "bold"
  });

  scene.state.statusText = scene.add.text(112, 382, "", {
    fontFamily: "Arial Narrow, Trebuchet MS, sans-serif",
    fontSize: "18px",
    color: "#111111",
    fontStyle: "bold",
    wordWrap: { width: 520 }
  });

  scene.add.text(694, 360, "PIN RESOLUTION", {
    fontFamily: "Arial Narrow, Trebuchet MS, sans-serif",
    fontSize: "17px",
    color: "#df347d",
    fontStyle: "bold"
  });

  scene.state.pinText = scene.add.text(694, 382, "", {
    fontFamily: "Arial Narrow, Trebuchet MS, sans-serif",
    fontSize: "16px",
    color: "#111111",
    fontStyle: "bold",
    wordWrap: { width: 220 },
    lineSpacing: 3
  });

  scene.add.text(978, 360, "TURN", {
    fontFamily: "Arial Narrow, Trebuchet MS, sans-serif",
    fontSize: "17px",
    color: "#df347d",
    fontStyle: "bold"
  }).setOrigin(1, 0);

  scene.state.turnText = scene.add.text(978, 382, "", {
    fontFamily: "Impact, Arial Black, sans-serif",
    fontSize: "22px",
    color: "#111111",
    align: "right"
  });
  scene.state.turnText.setOrigin(1, 0);
}

function createHandZone(scene) {
  scene.add.rectangle(90, 474, 940, 236, COLORS.cyan, 1).setOrigin(0);

  const panel = scene.add.rectangle(80, 464, 940, 236, COLORS.posterYellow, 1).setOrigin(0);
  panel.setStrokeStyle(6, COLORS.ink);

  scene.add.text(108, 480, "YOUR HAND", {
    fontFamily: "Impact, Arial Black, sans-serif",
    fontSize: "32px",
    color: "#df347d"
  });

  scene.state.drawPileText = scene.add.text(978, 486, "", {
    fontFamily: "Arial Narrow, Trebuchet MS, sans-serif",
    fontSize: "17px",
    color: "#312519",
    fontStyle: "bold",
    align: "right"
  });
  scene.state.drawPileText.setOrigin(1, 0);

  scene.state.handContainer = scene.add.container(0, 0);
}

function createOutcomeBanner(scene) {
  scene.state.outcomeText = scene.add.text(970, 88, "", {
    fontFamily: "Impact, Arial Black, sans-serif",
    fontSize: "42px",
    color: "#0f84a5"
  });
  scene.state.outcomeText.setOrigin(1, 0.5);
  scene.state.outcomeText.setAngle(-4);
  scene.state.outcomeText.setVisible(false);
}

function updateMatchPanel(scene) {
  updateWrestlerPanel(scene, "enemy");
  updateWrestlerPanel(scene, "player");
  scene.state.drawPileText.setText(`MAIN DECK ${scene.state.deck.length}`);
}

function updateWrestlerPanel(scene, wrestlerKey) {
  const wrestler = scene.state[wrestlerKey];
  const pinSummary = getPinfallSummary(wrestler);

  scene.state[`${wrestlerKey}NameText`].setText(wrestler.name);
  scene.state[`${wrestlerKey}HpText`].setText(`HP ${wrestler.hp} / ${wrestler.maxHp}`);
  scene.state[`${wrestlerKey}DamageText`].setText(`Damage ${wrestler.accumulatedDamage}`);
  scene.state[`${wrestlerKey}PinDeckText`].setText(`Pinfall ${pinSummary.total} cards`);
  scene.state[`${wrestlerKey}PinMixText`].setText(
    `Fail ${pinSummary.fail} | Kickout ${pinSummary.kickout}`
  );

  scene.state[`${wrestlerKey}HpFill`].clear();
  drawHpBar(
    scene.state[`${wrestlerKey}HpFill`],
    wrestlerKey === "enemy" ? 112 : 584,
    304,
    HP_BAR_WIDTH,
    wrestler.hp,
    wrestler.maxHp
  );
}

function getPinfallSummary(wrestler) {
  let fail = 0;
  let kickout = 0;

  wrestler.pinfallDeck.forEach((card) => {
    if (card === "Fail") {
      fail += 1;
      return;
    }

    kickout += 1;
  });

  return {
    total: wrestler.pinfallDeck.length,
    fail,
    kickout
  };
}

function drawHpBar(graphics, x, y, width, currentHp, maxHp) {
  const hpRatio = currentHp / maxHp;

  if (hpRatio <= 0) {
    return;
  }

  graphics.fillStyle(pickHpColor(hpRatio), 1);
  graphics.fillRect(x + 4, y + 4, (width - 8) * hpRatio, HP_BAR_HEIGHT - 8);
}

function pickHpColor(hpRatio) {
  if (hpRatio > 0.5) {
    return COLORS.healthCyan;
  }

  if (hpRatio > 0.25) {
    return COLORS.warningOrange;
  }

  return COLORS.dangerPink;
}

function updateStatusPanel(scene) {
  scene.state.statusText.setText(scene.state.statusMessage);
  scene.state.pinText.setText(scene.state.pinLogLines.join("\n"));
  scene.state.turnText.setText(formatTurnText(scene.state));
}

function updateInspectorPanels(scene) {
  updateMatchLogPanel(scene);
  updatePinfallDeckPanel(scene, "enemy");
  updatePinfallDeckPanel(scene, "player");
}

function updateMatchLogPanel(scene) {
  if (!dom.matchLogList || !dom.matchLogPanel) {
    return;
  }

  dom.matchLogList.replaceChildren();

  scene.state.matchLog.forEach((entry) => {
    const item = document.createElement("li");
    item.textContent = entry;
    dom.matchLogList.appendChild(item);
  });

  if (scene.state.shouldScrollLog) {
    dom.matchLogPanel.scrollTop = dom.matchLogPanel.scrollHeight;
    scene.state.shouldScrollLog = false;
  }
}

function updatePinfallDeckPanel(scene, wrestlerKey) {
  const wrestler = scene.state[wrestlerKey];
  const pinSummary = getPinfallSummary(wrestler);
  const summaryElement =
    wrestlerKey === "enemy" ? dom.enemyPinfallSummary : dom.playerPinfallSummary;
  const cardsElement =
    wrestlerKey === "enemy" ? dom.enemyPinfallCards : dom.playerPinfallCards;

  if (!summaryElement || !cardsElement) {
    return;
  }

  summaryElement.textContent = `${pinSummary.total} cards • Fail ${pinSummary.fail} • Kickout ${pinSummary.kickout}`;
  cardsElement.replaceChildren();

  const orderedDeck = [...wrestler.pinfallDeck].reverse();

  if (orderedDeck.length === 0) {
    const emptyChip = document.createElement("span");
    emptyChip.className = "pinfall-chip pinfall-chip--empty";
    emptyChip.textContent = "EMPTY";
    cardsElement.appendChild(emptyChip);
    return;
  }

  orderedDeck.forEach((card) => {
    const chip = document.createElement("span");
    chip.className = `pinfall-chip ${card === "Fail" ? "pinfall-chip--fail" : "pinfall-chip--kickout"}`;
    chip.textContent = card;
    cardsElement.appendChild(chip);
  });
}

function formatTurnText(state) {
  if (state.isGameOver) {
    return "MATCH OVER";
  }

  if (state.isResolvingPin) {
    return "PIN ATTEMPT";
  }

  return state.currentTurn === "player" ? "YOUR TURN" : "ENEMY TURN";
}

function formatCardTitle(name) {
  return name.toUpperCase().split(" ").join("\n");
}

function pickCardNameFontSize(name) {
  if (name.length >= 12) {
    return 15;
  }

  if (name.length >= 9) {
    return 17;
  }

  return 21;
}

function renderHand(scene) {
  const { hand, handContainer, isGameOver, isResolvingPin, currentTurn } = scene.state;
  const canPlayCards = !isGameOver && !isResolvingPin && currentTurn === "player";

  // Rebuilding the hand each time keeps the rendering logic easy to trust.
  handContainer.removeAll(true);

  const totalWidth = hand.length * CARD_WIDTH + Math.max(hand.length - 1, 0) * CARD_GAP;
  const startX = (GAME_WIDTH - totalWidth) / 2;
  const rowY = 510;

  hand.forEach((card, handIndex) => {
    const isPinCard = card.type === "pin";
    const cardX = startX + handIndex * (CARD_WIDTH + CARD_GAP);
    const cardContainer = scene.add.container(cardX, rowY);
    const cardBaseColor = canPlayCards ? COLORS.posterYellow : COLORS.mutedYellow;
    const headerColor = isPinCard ? COLORS.cyan : COLORS.magenta;
    const artColor = isPinCard ? COLORS.magenta : COLORS.cyan;
    const hoverArtColor = isPinCard ? COLORS.dangerPink : COLORS.cyanLight;
    const restingArtColor = canPlayCards ? artColor : COLORS.mutedBlue;
    const tilt = (handIndex - (hand.length - 1) / 2) * 0.7;
    const nameFontSize = pickCardNameFontSize(card.name);

    const printOffset = scene.add.rectangle(6, 6, CARD_WIDTH, CARD_HEIGHT, COLORS.cyan, 1).setOrigin(0);
    const cardFace = scene.add.rectangle(0, 0, CARD_WIDTH, CARD_HEIGHT, cardBaseColor, 1).setOrigin(0);
    cardFace.setStrokeStyle(5, COLORS.ink);

    const header = scene.add.rectangle(0, 0, CARD_WIDTH, 34, headerColor, 1).setOrigin(0);
    const artPanel = scene.add.rectangle(12, 46, CARD_WIDTH - 24, 68, restingArtColor, 1).setOrigin(0);
    const sideStripe = scene.add.rectangle(12, 46, 14, 68, headerColor, 1).setOrigin(0);
    const footerLine = scene.add.rectangle(12, 130, CARD_WIDTH - 24, 4, COLORS.ink, 1).setOrigin(0);
    const bottomStamp = scene.add.rectangle(12, 142, CARD_WIDTH - 24, 28, COLORS.cream, 1).setOrigin(0);
    bottomStamp.setStrokeStyle(3, COLORS.ink);

    const typeLabel = scene.add.text(CARD_WIDTH / 2, 17, isPinCard ? "PIN" : "ATTACK", {
      fontFamily: "Arial Narrow, Trebuchet MS, sans-serif",
      fontSize: "14px",
      color: "#ffe59e",
      fontStyle: "bold"
    }).setOrigin(0.5);

    const artMark = scene.add.text(30, 78, isPinCard ? "P" : card.name.charAt(0), {
      fontFamily: "Impact, Arial Black, sans-serif",
      fontSize: isPinCard ? "34px" : "40px",
      color: "#111111"
    }).setOrigin(0.5);
    artMark.setAlpha(0.55);

    const nameText = scene.add.text(CARD_WIDTH / 2 + 8, 79, formatCardTitle(card.name), {
      fontFamily: "Impact, Arial Black, sans-serif",
      fontSize: `${nameFontSize}px`,
      color: "#111111",
      align: "center",
      lineSpacing: -6,
      wordWrap: { width: CARD_WIDTH - 44 }
    }).setOrigin(0.5);

    const valueText = scene.add.text(CARD_WIDTH / 2, 155, isPinCard ? "PIN" : `${card.damage}`, {
      fontFamily: "Impact, Arial Black, sans-serif",
      fontSize: isPinCard ? "28px" : "32px",
      color: isPinCard ? "#0f84a5" : "#df347d"
    }).setOrigin(0.5);

    const valueLabel = scene.add.text(
      CARD_WIDTH / 2,
      174,
      isPinCard ? "ATTEMPT" : "DAMAGE",
      {
        fontFamily: "Arial Narrow, Trebuchet MS, sans-serif",
        fontSize: "12px",
        color: "#312519",
        fontStyle: "bold"
      }
    ).setOrigin(0.5);

    cardContainer.add([
      printOffset,
      cardFace,
      header,
      artPanel,
      sideStripe,
      footerLine,
      bottomStamp,
      typeLabel,
      artMark,
      nameText,
      valueText,
      valueLabel
    ]);
    cardContainer.setSize(CARD_WIDTH, CARD_HEIGHT);
    cardContainer.setAngle(tilt);

    if (canPlayCards) {
      // Give the container a hit area so the whole card responds, not just one child object.
      cardContainer.setInteractive(
        new Phaser.Geom.Rectangle(0, 0, CARD_WIDTH, CARD_HEIGHT),
        Phaser.Geom.Rectangle.Contains
      );

      cardContainer.on("pointerover", () => {
        cardContainer.y = rowY - 10;
        cardContainer.setAngle(tilt * 0.35);
        artPanel.setFillStyle(hoverArtColor, 1);
      });

      cardContainer.on("pointerout", () => {
        cardContainer.y = rowY;
        cardContainer.setAngle(tilt);
        artPanel.setFillStyle(restingArtColor, 1);
      });

      // The captured hand index maps this specific card view back to the right card data.
      cardContainer.on("pointerdown", () => {
        playCard(scene, handIndex);
      });
    }

    handContainer.add(cardContainer);
  });
}

function updateOutcomeBanner(scene) {
  const { outcomeText, isGameOver, outcome } = scene.state;

  if (!isGameOver) {
    outcomeText.setVisible(false);
    return;
  }

  outcomeText.setText(outcome === "win" ? "YOU WIN" : "YOU LOSE");
  outcomeText.setColor(outcome === "win" ? "#df347d" : "#111111");
  outcomeText.setVisible(true);
}

function restartMatch() {
  const scene = game.scene.getScene("UnderCardMatch");

  if (scene) {
    scene.scene.restart();
  }
}
