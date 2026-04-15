const HAND_SIZE = 6;
const MAX_SEQUENCE_SLOTS = 3;
const DAMAGE_PER_FAIL = 10;
const PIN_DRAW_COUNT = 3;
const STARTING_PIN_FAILS = 3;
const STARTING_PIN_KICKOUTS = 7;
const ENEMY_TURN_DELAY = 850;
const PIN_DRAW_DELAY = 650;
const COIN_SIDES = ["Heads", "Tails"];

const OFFENSIVE_TYPES = new Set(["attack", "taunt", "pin"]);
const DEFENSIVE_TYPES = new Set(["dodge", "reversal"]);
const RARITY_LIMITS = { common: 4, uncommon: 3, rare: 2, special: 1 };

const DATA_FILES = {
  cardPool: "data/card-pool.json",
  deckRecipe: "data/deck-recipe.json",
  wrestlers: "data/wrestlers.json"
};

const gameData = {
  cardPool: [],
  deckRecipe: [],
  wrestlers: [],
  cardLookup: {}
};

const app = {
  isReady: false,
  state: null,
  timers: new Set(),
  ui: {
    handFilter: "usable"
  }
};

const dom = {
  gameShell: document.querySelector(".game-shell"),
  playArea: document.querySelector(".play-area"),
  appContent: document.getElementById("app-content"),
  startupError: document.getElementById("startup-error"),
  restartButton: document.getElementById("restart-button"),
  directorTitle: document.getElementById("director-title"),
  directorSubtitle: document.getElementById("director-subtitle"),
  directorPrimary: document.getElementById("director-primary"),
  endTurnButton: document.getElementById("end-turn-button"),
  outcomeBanner: document.getElementById("outcome-banner"),
  sequenceCombo: document.getElementById("sequence-combo"),
  sequenceSlots: document.getElementById("sequence-slots"),
  actionTitle: document.getElementById("action-title"),
  actionText: document.getElementById("action-text"),
  actionOutcome: document.getElementById("action-outcome"),
  actionPhase: document.getElementById("action-phase"),
  actionButtons: document.getElementById("action-buttons"),
  actionPanel: document.querySelector(".action-panel"),
  choicePanel: document.querySelector(".choice-panel"),
  drawPileCount: document.getElementById("draw-pile-count"),
  handCards: document.getElementById("hand-cards"),
  handFilters: document.getElementById("hand-filters"),
  matchLogList: document.getElementById("match-log-list"),
  recentEventsList: document.getElementById("recent-events-list"),
  fullLogButton: document.getElementById("full-log-button"),
  logModal: document.getElementById("log-modal"),
  logModalBackdrop: document.querySelector("#log-modal .log-modal__backdrop"),
  closeLogButton: document.getElementById("close-log-button"),
  cardModal: document.getElementById("card-modal"),
  cardModalBackdrop: document.querySelector("#card-modal .card-modal__backdrop"),
  closeCardButton: document.getElementById("close-card-button"),
  cardModalType: document.getElementById("card-modal-type"),
  cardModalTitle: document.getElementById("card-modal-title"),
  cardModalMeta: document.getElementById("card-modal-meta"),
  cardModalValue: document.getElementById("card-modal-value"),
  cardModalReason: document.getElementById("card-modal-reason"),
  cardModalEffect: document.getElementById("card-modal-effect"),
  cardModalAction: document.getElementById("card-modal-action"),
  effectsLayer: document.getElementById("effects-layer"),
  wrestlerPanels: {
    enemy: {
      card: document.getElementById("enemy-summary"),
      name: document.getElementById("enemy-name"),
      role: document.getElementById("enemy-role"),
      stats: document.getElementById("enemy-stats"),
      pin: document.getElementById("enemy-pin"),
      status: document.getElementById("enemy-status")
    },
    player: {
      card: document.getElementById("player-summary"),
      name: document.getElementById("player-name"),
      role: document.getElementById("player-role"),
      stats: document.getElementById("player-stats"),
      pin: document.getElementById("player-pin"),
      status: document.getElementById("player-status")
    }
  }
};

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function getHandCardElement(handIndex) {
  return dom.handCards?.querySelector(`[data-hand-index="${handIndex}"]`) || null;
}

function getSequenceCardElement(slot, laneKey) {
  return dom.sequenceSlots?.querySelector(`.sequence-card[data-slot="${slot}"][data-lane="${laneKey}"]`) || null;
}

function makeRectAtCenter(rect, width, height) {
  if (!rect) {
    return null;
  }

  const resolvedWidth = Math.min(width, rect.width || width);
  const resolvedHeight = Math.min(height, rect.height || height);

  return {
    left: rect.left + rect.width / 2 - resolvedWidth / 2,
    top: rect.top + rect.height / 2 - resolvedHeight / 2,
    width: resolvedWidth,
    height: resolvedHeight
  };
}

function getPlaySourceRect(actorKey, handIndex, options = {}) {
  if (actorKey === "player") {
    const element = getHandCardElement(handIndex);
    return element ? element.getBoundingClientRect() : null;
  }

  const panel = dom.wrestlerPanels[actorKey]?.card;
  return panel ? makeRectAtCenter(panel.getBoundingClientRect(), options.width || 132, options.height || 92) : null;
}

function queueCardMotionEffect(sourceRect, slot, laneKey, card, result = "") {
  if (!sourceRect || !slot || prefersReducedMotion()) {
    return;
  }

  window.requestAnimationFrame(() => {
    const targetElement = getSequenceCardElement(slot, laneKey);

    if (!targetElement) {
      return;
    }

    animateCardMotionEffect(sourceRect, targetElement.getBoundingClientRect(), card, result);
  });
}

function animateCardMotionEffect(sourceRect, targetRect, card, result) {
  if (!dom.effectsLayer || !sourceRect || !targetRect) {
    return;
  }

  const effect = document.createElement("div");
  effect.className = "effect-card effect-card--motion";
  effect.style.left = `${sourceRect.left}px`;
  effect.style.top = `${sourceRect.top}px`;
  effect.style.width = `${sourceRect.width}px`;
  effect.style.height = `${sourceRect.height}px`;
  effect.style.transform = "rotate(-6deg) scale(0.96)";
  effect.innerHTML = `
    <p class="effect-card__type">${capitalize(card.type)}</p>
    <p class="effect-card__name">${card.name}</p>
    <p class="effect-card__result">${result || "In play"}</p>
  `;
  dom.effectsLayer.appendChild(effect);

  window.requestAnimationFrame(() => {
    effect.style.left = `${targetRect.left}px`;
    effect.style.top = `${targetRect.top}px`;
    effect.style.width = `${targetRect.width}px`;
    effect.style.height = `${targetRect.height}px`;
    effect.style.transform = "rotate(0deg) scale(1)";
  });

  window.setTimeout(() => {
    effect.style.opacity = "0";
    effect.style.transform = "scale(0.98)";
  }, 460);

  window.setTimeout(() => {
    effect.remove();
  }, 720);
}

function animateCoinFlipEffect(call, flips) {
  if (!dom.effectsLayer || prefersReducedMotion()) {
    return;
  }

  const anchor = dom.choicePanel?.getBoundingClientRect() || dom.actionPanel?.getBoundingClientRect();

  if (!anchor) {
    return;
  }

  const coin = document.createElement("div");
  coin.className = "effect-coin";
  coin.style.left = `${anchor.left + anchor.width / 2}px`;
  coin.style.top = `${anchor.top + anchor.height / 2}px`;
  coin.innerHTML = `<div class="effect-coin__face">Call<br>${call}</div>`;
  dom.effectsLayer.appendChild(coin);

  window.setTimeout(() => {
    coin.innerHTML = `<div class="effect-coin__face">${flips.join(" / ")}</div>`;
  }, 420);

  window.setTimeout(() => {
    coin.remove();
  }, 1100);
}

function animatePinDrawEffect(wrestlerKey, drawnCard, count) {
  if (!dom.effectsLayer || prefersReducedMotion()) {
    return;
  }

  const origin = dom.wrestlerPanels[wrestlerKey]?.pin?.getBoundingClientRect();
  const destination = dom.actionPanel?.getBoundingClientRect();

  if (!origin || !destination) {
    return;
  }

  const startRect = makeRectAtCenter(origin, 96, 56);
  const endRect = makeRectAtCenter(destination, 110, 64);

  if (!startRect || !endRect) {
    return;
  }

  const draw = document.createElement("div");
  draw.className = "effect-pin-draw effect-pin-draw--motion";
  draw.style.left = `${startRect.left}px`;
  draw.style.top = `${startRect.top}px`;
  draw.style.transform = "scale(0.94)";
  draw.textContent = `${drawnCard} ${count}`;
  dom.effectsLayer.appendChild(draw);

  window.requestAnimationFrame(() => {
    draw.style.left = `${endRect.left}px`;
    draw.style.top = `${endRect.top}px`;
    draw.style.transform = "scale(1)";
  });

  window.setTimeout(() => {
    draw.style.opacity = "0";
    draw.style.transform = "scale(0.98)";
  }, 540);

  window.setTimeout(() => {
    draw.remove();
  }, 860);
}

dom.restartButton.addEventListener("click", restartMatch);
dom.endTurnButton.addEventListener("click", () => {
  if (canPlayerEndTurn(app.state)) {
    finishTurn(app);
  }
});
if (dom.fullLogButton) {
  dom.fullLogButton.addEventListener("click", openLogModal);
}
if (dom.closeLogButton) {
  dom.closeLogButton.addEventListener("click", closeLogModal);
}
if (dom.logModalBackdrop) {
  dom.logModalBackdrop.addEventListener("click", closeLogModal);
}
if (dom.closeCardButton) {
  dom.closeCardButton.addEventListener("click", closeCardModal);
}
if (dom.cardModalBackdrop) {
  dom.cardModalBackdrop.addEventListener("click", closeCardModal);
}
if (dom.handFilters) {
  dom.handFilters.addEventListener("click", (event) => {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    const filter = target.getAttribute("data-filter");

    if (!filter) {
      return;
    }

    app.ui.handFilter = filter;
    dom.handFilters.querySelectorAll(".filter-chip").forEach((chip) => {
      chip.classList.toggle("is-active", chip.getAttribute("data-filter") === filter);
    });
    renderHand(app);
  });
}
document.addEventListener("click", (event) => {
  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target.closest(".info-button")) {
    event.preventDefault();
    event.stopPropagation();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }

  if (dom.cardModal && !dom.cardModal.hidden) {
    closeCardModal();
    return;
  }

  if (dom.logModal && !dom.logModal.hidden) {
    closeLogModal();
  }
});

boot();

async function boot() {
  try {
    await loadGameData();
    validateGameData();
    app.isReady = true;
    startMatch(app);
  } catch (error) {
    renderStartupError(error);
  }
}

async function loadGameData() {
  const loaded = await Promise.all(
    Object.entries(DATA_FILES).map(async ([key, path]) => {
      const response = await fetch(path);

      if (!response.ok) {
        throw new Error(`Could not load game data from ${path}.`);
      }

      const data = await response.json();

      if (!Array.isArray(data) || data.length === 0) {
        throw new Error(`Game data in ${path} is empty or invalid.`);
      }

      return [key, data];
    })
  );

  loaded.forEach(([key, data]) => {
    gameData[key] = data;
  });

  gameData.cardLookup = Object.fromEntries(gameData.cardPool.map((card) => [card.id, card]));
}

function validateGameData() {
  const baseDeckSize = gameData.deckRecipe.reduce((sum, entry) => sum + entry.count, 0);

  if (baseDeckSize !== 48) {
    throw new Error(`Base maneuver recipe must total 48 cards. Found ${baseDeckSize}.`);
  }

  gameData.deckRecipe.forEach((entry) => {
    const card = gameData.cardLookup[entry.cardId];

    if (!card) {
      throw new Error(`Deck recipe references unknown card id "${entry.cardId}".`);
    }

    if (entry.count > RARITY_LIMITS[card.rarity]) {
      throw new Error(`Deck recipe exceeds ${card.name}'s copy limit.`);
    }
  });

  gameData.wrestlers.forEach((wrestler) => {
    if (!wrestler.name || !wrestler.signature || !wrestler.finisher) {
      throw new Error("Each wrestler needs a name, signature, and finisher.");
    }

    validateDeckForWrestler(buildDeckForWrestler(wrestler), wrestler.name);
  });
}

function validateDeckForWrestler(deck, wrestlerName) {
  if (deck.length !== 50) {
    throw new Error(`${wrestlerName}'s deck must contain exactly 50 cards.`);
  }

  const counts = {};
  let pinCount = 0;

  deck.forEach((card) => {
    counts[card.id] = (counts[card.id] || 0) + 1;

    if (card.type === "pin") {
      pinCount += 1;
    }
  });

  if (pinCount < 1) {
    throw new Error(`${wrestlerName}'s deck must contain at least 1 pin card.`);
  }

  Object.entries(counts).forEach(([cardId, count]) => {
    const card = deck.find((entry) => entry.id === cardId);

    if (count > RARITY_LIMITS[card.rarity]) {
      throw new Error(`${wrestlerName}'s deck exceeds ${card.name}'s copy limit.`);
    }
  });
}

function renderStartupError(error) {
  console.error(error);

  const helperText =
    window.location.protocol === "file:"
      ? 'Open the project through a local server so the JSON files can load, for example <code>python -m http.server 8000</code>.'
      : "Check the browser console and confirm the JSON files are available.";

  dom.appContent.hidden = true;
  dom.startupError.hidden = false;
  dom.startupError.innerHTML = `
    <h2>Unable to load game data</h2>
    <p>${helperText}</p>
    <p class="startup-error__detail">${error.message}</p>
  `;
}

function restartMatch() {
  if (app.isReady) {
    startMatch(app);
  }
}

function startMatch(currentApp) {
  clearScheduledCalls(currentApp);
  currentApp.ui.handFilter = "usable";
  if (dom.handFilters) {
    dom.handFilters.querySelectorAll(".filter-chip").forEach((chip) => {
      chip.classList.toggle("is-active", chip.getAttribute("data-filter") === "usable");
    });
  }

  const matchup = pickRandomMatchup();
  const initiativeWinnerKey = Math.random() < 0.5 ? "player" : "enemy";

  currentApp.state = {
    player: createWrestlerState(matchup.player),
    enemy: createWrestlerState(matchup.enemy),
    currentTurn: initiativeWinnerKey,
    initiativeWinnerKey,
    turnNumber: 1,
    sequence: createSequence(),
    pendingDefense: null,
    pendingCoin: null,
    pendingStep: null,
    pinAttempt: null,
    isGameOver: false,
    outcome: null,
    statusMessage: "",
    matchLog: [],
    shouldScrollLog: false,
    pinLogLines: []
  };

  drawOpeningHands(currentApp.state.player);
  drawOpeningHands(currentApp.state.enemy);

  addMatchLog(currentApp, `${currentApp.state.player.name} vs ${currentApp.state.enemy.name}.`);
  addMatchLog(currentApp, "Both wrestlers draw 6 maneuver cards.");
  addMatchLog(
    currentApp,
    `Coin toss gives initiative to ${currentApp.state[initiativeWinnerKey].name}.`
  );

  beginTurn(currentApp, initiativeWinnerKey, { skipDraw: true });
}

function pickRandomMatchup() {
  const roster = gameData.wrestlers;
  const playerIndex = Math.floor(Math.random() * roster.length);
  let enemyIndex = playerIndex;

  while (roster.length > 1 && enemyIndex === playerIndex) {
    enemyIndex = Math.floor(Math.random() * roster.length);
  }

  return {
    player: cloneWrestlerTemplate(roster[playerIndex]),
    enemy: cloneWrestlerTemplate(roster[enemyIndex])
  };
}

function cloneWrestlerTemplate(wrestler) {
  return {
    name: wrestler.name,
    signature: cloneSpecialMove(wrestler.signature),
    finisher: cloneSpecialMove(wrestler.finisher)
  };
}

function cloneSpecialMove(move) {
  return { ...move, effects: cloneEffects(move.effects) };
}

function createWrestlerState(template) {
  return {
    name: template.name,
    maneuverDeck: shuffleArray(buildDeckForWrestler(template)),
    hand: [],
    discardPile: [],
    pinfallDeck: buildPinfallDeck(),
    accumulatedDamage: 0,
    failCardsFromDamage: 0,
    stunned: false,
    exhaustionPendingLoss: false
  };
}

function buildDeckForWrestler(wrestler) {
  const deck = [];

  gameData.deckRecipe.forEach((entry) => {
    const definition = gameData.cardLookup[entry.cardId];

    for (let index = 0; index < entry.count; index += 1) {
      deck.push(createCardInstance(definition));
    }
  });

  deck.push(createSpecialCardInstance(wrestler, "signature"));
  deck.push(createSpecialCardInstance(wrestler, "finisher"));
  return deck;
}

function createCardInstance(card) {
  return { ...card, effects: cloneEffects(card.effects) };
}

function createSpecialCardInstance(wrestler, moveKey) {
  const move = wrestler[moveKey];

  return {
    id: `${slugify(wrestler.name)}_${moveKey}`,
    name: move.name,
    type: move.type || "attack",
    rarity: "special",
    slot: move.slot,
    damage: move.damage || 0,
    missDamage: move.missDamage || 2,
    reversalDamage: move.reversalDamage || 0,
    immediatePin: Boolean(move.immediatePin),
    effects: cloneEffects(move.effects)
  };
}

function cloneEffects(effects = []) {
  return effects.map((effect) => ({ ...effect }));
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function drawOpeningHands(wrestler) {
  while (wrestler.hand.length < HAND_SIZE && wrestler.maneuverDeck.length > 0) {
    wrestler.hand.push(wrestler.maneuverDeck.pop());
  }
}

function buildPinfallDeck() {
  const deck = [];

  for (let index = 0; index < STARTING_PIN_FAILS; index += 1) {
    deck.push("Fail");
  }

  for (let index = 0; index < STARTING_PIN_KICKOUTS; index += 1) {
    deck.push("Kickout");
  }

  return shuffleArray(deck);
}

function createSequence() {
  return {
    nextSlot: 1,
    totalPlayed: 0,
    successfulSlots: 0,
    comboEligible: true,
    slots: Array.from({ length: MAX_SEQUENCE_SLOTS }, (_, index) => {
      return {
        slot: index + 1,
        cardName: "",
        type: "",
        fit: true,
        landed: false,
        result: "Open",
        offense: null,
        defense: null
      };
    })
  };
}

function beginTurn(currentApp, attackerKey, options = {}) {
  if (!currentApp.state || currentApp.state.isGameOver) {
    return;
  }

  clearTurnInteractions(currentApp.state);
  currentApp.state.currentTurn = attackerKey;
  currentApp.state.sequence = createSequence();
  currentApp.state.pinLogLines = [];

  const attacker = currentApp.state[attackerKey];

  if (!options.skipDraw) {
    const drawn = drawToHand(currentApp, attackerKey, HAND_SIZE);

    if (drawn > 0) {
      addMatchLog(currentApp, `${attacker.name} draws ${drawn} ${pluralize("card", drawn)}.`);
    } else if (attacker.maneuverDeck.length === 0) {
      addMatchLog(currentApp, `${attacker.name} has no maneuver cards left to draw.`);
    }
  }

  if (attacker.stunned) {
    addMatchLog(currentApp, `${attacker.name} starts the turn stunned.`);
  }

  currentApp.state.statusMessage = `${attacker.name}'s turn.`;
  renderApp(currentApp);

  if (attackerKey === "enemy") {
    queueEnemyTurnStep(currentApp);
  }
}

function drawToHand(currentApp, wrestlerKey, targetSize) {
  const wrestler = currentApp.state[wrestlerKey];
  let drawn = 0;

  while (wrestler.hand.length < targetSize && wrestler.maneuverDeck.length > 0) {
    wrestler.hand.push(wrestler.maneuverDeck.pop());
    drawn += 1;
  }

  if (wrestler.maneuverDeck.length === 0 && !wrestler.exhaustionPendingLoss) {
    wrestler.exhaustionPendingLoss = true;
    addMatchLog(
      currentApp,
      `${wrestler.name} is out of maneuver cards and must win before this turn ends.`
    );
  }

  return drawn;
}

function clearTurnInteractions(state) {
  state.pendingDefense = null;
  state.pendingCoin = null;
  state.pendingStep = null;
  state.pinAttempt = null;
}

function canPlayerEndTurn(state) {
  if (!state || state.isGameOver || state.currentTurn !== "player") {
    return false;
  }

  return (
    !state.pendingDefense &&
    !state.pendingCoin &&
    !state.pendingStep &&
    !state.pinAttempt
  );
}

function runEnemyTurnStep(currentApp) {
  const { state } = currentApp;

  if (
    !state ||
    state.isGameOver ||
    state.currentTurn !== "enemy" ||
    state.pendingDefense ||
    state.pendingCoin ||
    state.pendingStep ||
    state.pinAttempt
  ) {
    return;
  }

  if (state.sequence.totalPlayed >= MAX_SEQUENCE_SLOTS) {
    finishTurn(currentApp);
    return;
  }

  const cardIndex = chooseEnemyOffensiveCard(currentApp);

  if (cardIndex === -1) {
    finishTurn(currentApp);
    return;
  }

  playOffensiveCard(currentApp, "enemy", cardIndex);
}

function queueEnemyTurnStep(currentApp) {
  const { state } = currentApp;

  if (
    !state ||
    state.isGameOver ||
    state.currentTurn !== "enemy" ||
    state.pendingDefense ||
    state.pendingCoin ||
    state.pendingStep ||
    state.pinAttempt
  ) {
    return;
  }

  const enemyHasOffense = state.enemy.hand.some((card) => OFFENSIVE_TYPES.has(card.type));

  if (state.sequence.totalPlayed >= MAX_SEQUENCE_SLOTS || !enemyHasOffense) {
    queuePendingStep(
      currentApp,
      `Defending ${state.enemy.name}'s turn`,
      enemyHasOffense
        ? "Sequence done. End turn."
        : "No offense left. End turn.",
      [
        {
          label: "End Turn",
          onClick: () => {
            finishTurn(currentApp);
          }
        }
      ]
    );
    return;
  }

  queuePendingStep(
    currentApp,
    `Defending ${state.enemy.name}'s turn`,
    `Reveal slot ${state.sequence.nextSlot}.`,
    [
      {
        label: `Reveal Slot ${state.sequence.nextSlot}`,
        onClick: () => {
          runEnemyTurnStep(currentApp);
        }
      }
    ]
  );
}

function queuePendingStep(currentApp, title, text, buttons) {
  currentApp.state.pendingStep = {
    title,
    text,
    buttons: buttons.map((button) => {
      return {
        label: button.label,
        tone: button.tone,
        disabled: button.disabled,
        onClick: () => {
          currentApp.state.pendingStep = null;
          button.onClick();
        }
      };
    })
  };
  renderApp(currentApp);
}

function chooseEnemyOffensiveCard(currentApp) {
  const enemy = currentApp.state.enemy;
  const defender = currentApp.state.player;
  const slot = currentApp.state.sequence.nextSlot;
  const offensiveEntries = enemy.hand
    .map((card, index) => ({ card, index }))
    .filter((entry) => OFFENSIVE_TYPES.has(entry.card.type));

  if (offensiveEntries.length === 0) {
    return -1;
  }

  const fitting = offensiveEntries.filter((entry) => doesCardFitSlot(entry.card, slot));
  const pool = fitting.length > 0 ? fitting : offensiveEntries;
  const pinSummary = getPinfallSummary(defender);
  const failRatio = pinSummary.total > 0 ? pinSummary.fail / pinSummary.total : 0;

  const scored = pool.map((entry) => {
    return {
      ...entry,
      score: scoreEnemyCard(entry.card, defender.accumulatedDamage, failRatio, slot)
    };
  });

  scored.sort((left, right) => right.score - left.score);
  return scored[0].index;
}

function scoreEnemyCard(card, defenderDamage, failRatio, slot) {
  let score = Math.random() * 2;

  if (card.type === "attack") {
    score += 18 + (card.damage || 0);
  }

  if (card.type === "taunt") {
    score += 12 + countPinfallPressure(card, "Fail") * 4 + countPinfallPressure(card, "Kickout") * 3;
  }

  if (card.type === "pin") {
    score += defenderDamage * 0.5 + failRatio * 20 + (slot === 1 ? 2 : 0);
  }

  if (card.immediatePin && defenderDamage >= 14) {
    score += 10;
  }

  if (hasEffectType(card, "stun")) {
    score += 6;
  }

  return score;
}

function playOffensiveCard(currentApp, attackerKey, handIndex) {
  const { state } = currentApp;

  if (
    !state ||
    state.isGameOver ||
    state.pendingDefense ||
    state.pendingCoin ||
    state.pinAttempt ||
    state.currentTurn !== attackerKey ||
    state.sequence.totalPlayed >= MAX_SEQUENCE_SLOTS
  ) {
    return;
  }

  const attacker = state[attackerKey];
  const sourceRect = getPlaySourceRect(attackerKey, handIndex, { width: 132, height: 92 });
  const [card] = attacker.hand.splice(handIndex, 1);

  if (!card || !OFFENSIVE_TYPES.has(card.type)) {
    return;
  }

  attacker.discardPile.push(card);

  const defenderKey = getOpponentKey(attackerKey);
  const slot = state.sequence.nextSlot;
  const fitsSlot = doesCardFitSlot(card, slot);
  const slotEntry = state.sequence.slots[slot - 1];
  slotEntry.cardName = card.name;
  slotEntry.type = card.type;
  slotEntry.fit = fitsSlot;
  slotEntry.result = "Resolving";
  slotEntry.offense = createSequenceCardState(attackerKey, card, "Resolving", { fit: fitsSlot });
  slotEntry.defense = null;
  state.sequence.totalPlayed += 1;
  state.sequence.nextSlot += 1;

  addMatchLog(
    currentApp,
    `${attacker.name} plays ${card.name} in slot ${slot}${fitsSlot ? "." : " off-slot."}`
  );

  state.statusMessage = `${attacker.name} resolves ${card.name}.`;
  renderApp(currentApp);
  queueCardMotionEffect(sourceRect, slot, attackerKey, card, "Played");

  const context = {
    attackerKey,
    defenderKey,
    card,
    slot,
    fitsSlot,
    onResolved: (landed, resultLabel) => {
      finalizeSequenceSlot(currentApp, slot, landed, card, fitsSlot, resultLabel);
      resumeTurnFlow(currentApp);
    }
  };

  if (card.type === "pin") {
    startPinDefense(currentApp, {
      attackerKey,
      defenderKey,
      pinName: card.name,
      sourceCard: card,
      slot,
      fitsSlot,
      onResolved: (landed) => {
        context.onResolved(landed, landed ? "Pin lands" : "Pin stopped");
      }
    });
    return;
  }

  resolveManeuverDefense(currentApp, context);
}

function resolveManeuverDefense(currentApp, context) {
  const defenseOptions = getDefenseOptions(currentApp.state[context.defenderKey]);

  if (defenseOptions.length === 0) {
    resolveOffensiveCardWithoutDefense(currentApp, context);
    return;
  }

  if (context.defenderKey === "enemy") {
    const aiChoice = chooseAIDefense(currentApp, context, defenseOptions);

    if (!aiChoice) {
      resolveOffensiveCardWithoutDefense(currentApp, context);
      return;
    }

    queuePendingStep(
      currentApp,
      `${currentApp.state.enemy.name} defending`,
      `${currentApp.state.enemy.name} reaches for a defense.`,
      [
        {
          label: "Reveal Defense",
          onClick: () => {
            commitAIDefense(currentApp, context, aiChoice);
          }
        }
      ]
    );
    return;
  }

  currentApp.state.pendingDefense = { kind: "maneuver", context };
  currentApp.state.statusMessage = `${currentApp.state.player.name} can defend ${context.card.name}.`;
  renderApp(currentApp);
}

function startPinDefense(currentApp, pinContext) {
  const attacker = currentApp.state[pinContext.attackerKey];
  const defender = currentApp.state[pinContext.defenderKey];
  const defenseOptions = getDefenseOptions(defender);

  currentApp.state.statusMessage = `${attacker.name} attempts ${pinContext.pinName}!`;
  currentApp.state.pinLogLines = [`${attacker.name} goes for ${pinContext.pinName}.`];
  renderApp(currentApp);

  if (defenseOptions.length === 0) {
    startPinfallAttempt(currentApp, pinContext);
    return;
  }

  const context = {
    attackerKey: pinContext.attackerKey,
    defenderKey: pinContext.defenderKey,
    slot: pinContext.slot ?? null,
    card: {
      name: pinContext.pinName,
      type: "pin",
      slot: pinContext.sourceCard.slot
    },
    fitsSlot: pinContext.fitsSlot ?? true,
    pinContext
  };

  if (pinContext.defenderKey === "enemy") {
    const aiChoice = chooseAIDefense(currentApp, context, defenseOptions);

    if (!aiChoice) {
      startPinfallAttempt(currentApp, pinContext);
      return;
    }

    queuePendingStep(
      currentApp,
      `${defender.name} defending`,
      `${defender.name} braces for the pin.`,
      [
        {
          label: "Reveal Defense",
          onClick: () => {
            commitAIDefense(currentApp, context, aiChoice);
          }
        }
      ]
    );
    return;
  }

  currentApp.state.pendingDefense = { kind: "pin", context };
  currentApp.state.statusMessage = `${defender.name} can dodge or reverse the pin.`;
  renderApp(currentApp);
}

function getDefenseOptions(wrestler) {
  return wrestler.hand
    .map((card, handIndex) => ({ card, handIndex }))
    .filter((entry) => DEFENSIVE_TYPES.has(entry.card.type));
}

function chooseAIDefense(currentApp, context, defenseOptions) {
  const threat =
    (context.card.damage || 0) +
    countPinfallPressure(context.card, "Fail") * 3 +
    (hasEffectType(context.card, "stun") ? 4 : 0) +
    (context.card.type === "pin" ? 8 : 0);

  let chanceToDefend = 0.35;

  if (context.card.type === "pin") {
    chanceToDefend = 0.95;
  } else if (context.card.type === "taunt") {
    chanceToDefend = 0.55;
  } else if (threat >= 10) {
    chanceToDefend = 0.8;
  } else if (threat >= 7) {
    chanceToDefend = 0.65;
  }

  if (Math.random() > chanceToDefend) {
    return null;
  }

  const reversals = defenseOptions.filter((entry) => entry.card.type === "reversal");
  const dodges = defenseOptions.filter((entry) => entry.card.type === "dodge");

  if (context.card.type === "pin" && reversals.length > 0 && Math.random() > 0.4) {
    return pickRandom(reversals);
  }

  if (context.card.type === "attack" && reversals.length > 0 && (context.card.damage || 0) >= 8) {
    return pickRandom(reversals);
  }

  if (dodges.length > 0) {
    return pickRandom(dodges);
  }

  return reversals[0] || null;
}

function commitAIDefense(currentApp, context, aiChoice) {
  const defender = currentApp.state[context.defenderKey];
  const sourceRect = getPlaySourceRect(context.defenderKey, aiChoice.handIndex, {
    width: 132,
    height: 92
  });
  const [defenseCard] = defender.hand.splice(aiChoice.handIndex, 1);

  if (!defenseCard) {
    if (context.pinContext) {
      startPinfallAttempt(currentApp, context.pinContext);
      return;
    }

    resolveOffensiveCardWithoutDefense(currentApp, context);
    return;
  }

  defender.discardPile.push(defenseCard);
  setSequenceDefenseCard(currentApp.state, context.slot, context.defenderKey, defenseCard, "Readied");

  const aiCall = pickRandom(COIN_SIDES);

  currentApp.state.statusMessage = `${defender.name} reveals ${defenseCard.name}.`;
  currentApp.state.pendingCoin = {
    phase: "reveal",
    actorKey: context.defenderKey,
    context,
    defenseCard,
    call: aiCall
  };
  renderApp(currentApp);
  queueCardMotionEffect(sourceRect, context.slot, context.defenderKey, defenseCard, "Defense");
}

function resolveDefenseAttempt(currentApp, context, defenseCard, call) {
  const coinMode = getCoinMode(currentApp, context);
  const flips = flipCoins(coinMode === "normal" ? 1 : 2);
  const success = evaluateCoinResult(flips, call, coinMode);
  const defender = currentApp.state[context.defenderKey];

  animateCoinFlipEffect(call, flips);

  addMatchLog(
    currentApp,
    `${defender.name} calls ${call} with ${defenseCard.name}. Coins: ${flips.join(" / ")}.`
  );

  if (success) {
    handleSuccessfulDefense(currentApp, context, defenseCard, coinMode);
    return;
  }

  handleFailedDefense(currentApp, context, defenseCard, coinMode);
}

function getCoinMode(currentApp, context) {
  const attacker = currentApp.state[context.attackerKey];
  const defender = currentApp.state[context.defenderKey];
  const attackDisadvantaged = !context.fitsSlot || attacker.stunned;
  const defenseDisadvantaged = defender.stunned;

  if (attackDisadvantaged && defenseDisadvantaged) {
    return "normal";
  }

  if (defenseDisadvantaged) {
    return "hard";
  }

  if (attackDisadvantaged) {
    return "easy";
  }

  return "normal";
}

function flipCoins(count) {
  return Array.from({ length: count }, () => pickRandom(COIN_SIDES));
}

function evaluateCoinResult(flips, call, coinMode) {
  if (coinMode === "easy") {
    return flips.some((flip) => flip === call);
  }

  if (coinMode === "hard") {
    return flips.every((flip) => flip === call);
  }

  return flips[0] === call;
}

function handleSuccessfulDefense(currentApp, context, defenseCard, coinMode) {
  const attacker = currentApp.state[context.attackerKey];
  const defender = currentApp.state[context.defenderKey];

  if (context.card.type === "pin") {
    if (defenseCard.type === "dodge") {
      setSequenceDefenseResult(currentApp.state, context.slot, "Dodged");
      addMatchLog(
        currentApp,
        `${defender.name} dodges ${context.card.name} (${coinModeLabel(coinMode)}).`
      );
      context.pinContext.onResolved(false);
      return;
    }

    addMatchLog(
      currentApp,
      `${defender.name} reverses ${context.card.name} (${coinModeLabel(coinMode)}).`
    );
    setSequenceDefenseResult(currentApp.state, context.slot, "Reversal");
    startPinDefense(currentApp, {
      attackerKey: context.defenderKey,
      defenderKey: context.attackerKey,
      pinName: `${context.card.name} Reversal`,
      sourceCard: context.pinContext.sourceCard,
      fitsSlot: true,
      onResolved: () => {
        context.pinContext.onResolved(false);
      }
    });
    return;
  }

  if (context.card.type === "taunt") {
    setSequenceDefenseResult(currentApp.state, context.slot, "Stopped");
    addMatchLog(
      currentApp,
      `${defender.name} shuts down ${attacker.name}'s ${context.card.name} (${coinModeLabel(
        coinMode
      )}).`
    );
    context.onResolved(false, "Blocked");
    return;
  }

  if (defenseCard.type === "dodge") {
    const damageResult = applyDamage(currentApp, context.attackerKey, defenseCard.missDamage || 0);
    setSequenceDefenseResult(currentApp.state, context.slot, "Dodge");

    addMatchLog(
      currentApp,
      `${defender.name} dodges ${context.card.name}. ${attacker.name} takes ${defenseCard.missDamage || 0} miss damage.`
    );
    logDamageThresholds(currentApp, context.attackerKey, damageResult.failCardsAdded);
    context.onResolved(false, "Dodged");
    return;
  }

  const reversalResult = applyDamage(
    currentApp,
    context.attackerKey,
    defenseCard.reversalDamage || 0
  );
  setSequenceDefenseResult(currentApp.state, context.slot, "Reversal");

  addMatchLog(
    currentApp,
    `${defender.name} reverses ${context.card.name}. ${attacker.name} takes ${defenseCard.reversalDamage || 0} reversal damage.`
  );
  logDamageThresholds(currentApp, context.attackerKey, reversalResult.failCardsAdded);
  context.onResolved(false, "Reversed");
}

function handleFailedDefense(currentApp, context, defenseCard, coinMode) {
  const defender = currentApp.state[context.defenderKey];
  setSequenceDefenseResult(currentApp.state, context.slot, "Missed");

  addMatchLog(
    currentApp,
    `${defender.name}'s ${defenseCard.name} fails (${coinModeLabel(coinMode)}).`
  );

  if (context.card.type === "pin") {
    startPinfallAttempt(currentApp, context.pinContext);
    return;
  }

  resolveOffensiveCardWithoutDefense(currentApp, context);
}

function resolveOffensiveCardWithoutDefense(currentApp, context) {
  if (context.card.type === "attack") {
    resolveAttackHit(currentApp, context);
    return;
  }

  if (context.card.type === "taunt") {
    resolveTauntHit(currentApp, context);
  }
}

function resolveAttackHit(currentApp, context) {
  const attacker = currentApp.state[context.attackerKey];
  const defender = currentApp.state[context.defenderKey];
  const damageResult = applyDamage(currentApp, context.defenderKey, context.card.damage || 0);

  addMatchLog(
    currentApp,
    `${attacker.name} lands ${context.card.name} for ${context.card.damage} damage on ${defender.name}.`
  );
  logDamageThresholds(currentApp, context.defenderKey, damageResult.failCardsAdded);
  logEffectMessages(currentApp, applyCardEffects(currentApp, context.attackerKey, context.defenderKey, context.card));

  if (context.card.immediatePin) {
    addMatchLog(currentApp, `${attacker.name} can roll straight into a pin off ${context.card.name}.`);
    finalizeSequenceSlot(currentApp, context.slot, true, context.card, context.fitsSlot, "Landed");
    startPinDefense(currentApp, {
      attackerKey: context.attackerKey,
      defenderKey: context.defenderKey,
      pinName: `${context.card.name} Cover`,
      sourceCard: context.card,
      slot: context.slot,
      fitsSlot: true,
      onResolved: () => {
        resumeTurnFlow(currentApp);
      }
    });
    return;
  }

  context.onResolved(true, "Landed");
}

function resolveTauntHit(currentApp, context) {
  const attacker = currentApp.state[context.attackerKey];
  const defender = currentApp.state[context.defenderKey];

  addMatchLog(currentApp, `${attacker.name}'s ${context.card.name} rattles ${defender.name}.`);
  logEffectMessages(currentApp, applyCardEffects(currentApp, context.attackerKey, context.defenderKey, context.card));
  context.onResolved(true, "Taunt");
}

function startPinfallAttempt(currentApp, pinContext) {
  currentApp.state.pinAttempt = {
    attackerKey: pinContext.attackerKey,
    defenderKey: pinContext.defenderKey,
    slot: pinContext.slot ?? null,
    pinName: pinContext.pinName,
    drawnCards: [],
    pendingOutcome: null,
    onResolved: pinContext.onResolved
  };

  currentApp.state.pinLogLines = [
    `${currentApp.state[pinContext.attackerKey].name} uses ${pinContext.pinName}.`,
    `${currentApp.state[pinContext.defenderKey].name} draws ${PIN_DRAW_COUNT} from the pinfall deck.`
  ];
  addMatchLogLines(currentApp, currentApp.state.pinLogLines);
  currentApp.state.statusMessage = `${currentApp.state[pinContext.defenderKey].name} is fighting the pin.`;
  renderApp(currentApp);
}

function resolveNextPinDraw(currentApp) {
  const attempt = currentApp.state.pinAttempt;

  if (!attempt || currentApp.state.isGameOver) {
    return;
  }

  const defender = currentApp.state[attempt.defenderKey];
  const drawnCard = defender.pinfallDeck.pop();

  attempt.drawnCards.push(drawnCard);
  addMatchLog(currentApp, `Count ${attempt.drawnCards.length}: ${drawnCard}`);
  currentApp.state.pinLogLines = buildPinLogLines(currentApp, attempt);
  currentApp.state.statusMessage = `${defender.name} reveals pinfall card ${attempt.drawnCards.length}.`;
  renderApp(currentApp);
  animatePinDrawEffect(attempt.defenderKey, drawnCard, attempt.drawnCards.length);

  if (drawnCard === "Kickout") {
    attempt.pendingOutcome = "kickout";
    return;
  }

  if (attempt.drawnCards.length >= PIN_DRAW_COUNT) {
    attempt.pendingOutcome = "fall";
  }
}

function buildPinLogLines(currentApp, attempt) {
  const lines = [`${currentApp.state[attempt.attackerKey].name} uses ${attempt.pinName}.`];

  attempt.drawnCards.forEach((card, index) => {
    lines.push(`Count ${index + 1}: ${card}`);
  });

  if (attempt.drawnCards.includes("Kickout")) {
    lines.push(`Kickout at ${attempt.drawnCards.length}.`);
  }

  return lines;
}

function finishFailedPin(currentApp) {
  const attempt = currentApp.state.pinAttempt;

  if (!attempt) {
    return;
  }

  const defender = currentApp.state[attempt.defenderKey];

  defender.pinfallDeck.push(...attempt.drawnCards);
  shuffleArray(defender.pinfallDeck);

  addMatchLog(currentApp, `${defender.name} kicks out and the drawn pinfall cards shuffle back in.`);
  currentApp.state.pinAttempt = null;
  currentApp.state.statusMessage = `${defender.name} survives the pin.`;
  currentApp.state.pinLogLines = [`${defender.name} kicks out at ${attempt.drawnCards.length}.`];
  renderApp(currentApp);
  attempt.onResolved(true);
}

function finishSuccessfulPin(currentApp) {
  const attempt = currentApp.state.pinAttempt;

  if (!attempt) {
    return;
  }

  const attacker = currentApp.state[attempt.attackerKey];

  currentApp.state.pinAttempt = null;
  currentApp.state.pinLogLines = ["Three straight Fail cards. The pin holds."];
  endMatch(
    currentApp,
    attempt.attackerKey === "player" ? "win" : "lose",
    `${attacker.name} gets the three-count with ${attempt.pinName}!`
  );
}

function applyDamage(currentApp, wrestlerKey, amount) {
  const wrestler = currentApp.state[wrestlerKey];
  wrestler.accumulatedDamage += amount;
  return { failCardsAdded: addFailCardsFromDamage(wrestler) };
}

function addFailCardsFromDamage(wrestler) {
  const failCardsEarned = Math.floor(wrestler.accumulatedDamage / DAMAGE_PER_FAIL);
  const failCardsToAdd = failCardsEarned - wrestler.failCardsFromDamage;

  if (failCardsToAdd <= 0) {
    return 0;
  }

  for (let index = 0; index < failCardsToAdd; index += 1) {
    wrestler.pinfallDeck.push("Fail");
  }

  wrestler.failCardsFromDamage = failCardsEarned;
  shuffleArray(wrestler.pinfallDeck);
  return failCardsToAdd;
}

function logDamageThresholds(currentApp, wrestlerKey, failCardsAdded) {
  if (failCardsAdded <= 0) {
    return;
  }

  const wrestler = currentApp.state[wrestlerKey];

  addMatchLog(currentApp, `${wrestler.name} reaches ${wrestler.accumulatedDamage} total damage.`);
  addMatchLog(
    currentApp,
    `${failCardsAdded} ${pluralize("Fail card", failCardsAdded)} added from the damage threshold.`
  );
}

function applyCardEffects(currentApp, ownerKey, opponentKey, card) {
  const messages = [];

  (card.effects || []).forEach((effect) => {
    if (effect.type === "pinfall") {
      const receiverKey = effect.target === "self" ? ownerKey : opponentKey;
      addCardsToPinfallDeck(currentApp.state[receiverKey], effect.card, effect.amount);
      messages.push(
        `${currentApp.state[receiverKey].name} gains ${effect.amount} ${effect.card} ${pluralize(
          "card",
          effect.amount
        )} in the pinfall deck.`
      );
      return;
    }

    if (effect.type === "stun") {
      const receiverKey = effect.target === "self" ? ownerKey : opponentKey;
      const target = currentApp.state[receiverKey];
      const refreshed = target.stunned;
      target.stunned = true;
      messages.push(
        refreshed
          ? `${target.name}'s stun is refreshed.`
          : `${target.name} is stunned until the end of the next turn.`
      );
    }
  });

  return messages;
}

function addCardsToPinfallDeck(wrestler, cardType, amount) {
  for (let index = 0; index < amount; index += 1) {
    wrestler.pinfallDeck.push(cardType);
  }

  shuffleArray(wrestler.pinfallDeck);
}

function logEffectMessages(currentApp, messages) {
  messages.forEach((message) => addMatchLog(currentApp, message));
}

function createSequenceCardState(ownerKey, card, result, options = {}) {
  return {
    ownerKey,
    cardName: card.name,
    type: card.type,
    result,
    fit: options.fit ?? true
  };
}

function getSequenceSlotEntry(state, slot) {
  if (!slot || !state?.sequence) {
    return null;
  }

  return state.sequence.slots[slot - 1] || null;
}

function setSequenceDefenseCard(state, slot, ownerKey, card, result = "Readied") {
  const slotEntry = getSequenceSlotEntry(state, slot);

  if (!slotEntry) {
    return;
  }

  slotEntry.defense = createSequenceCardState(ownerKey, card, result);
}

function setSequenceDefenseResult(state, slot, result) {
  const slotEntry = getSequenceSlotEntry(state, slot);

  if (!slotEntry || !slotEntry.defense) {
    return;
  }

  slotEntry.defense.result = result;
}

function finalizeSequenceSlot(currentApp, slot, landed, card, fitsSlot, resultLabel) {
  const slotEntry = currentApp.state.sequence.slots[slot - 1];

  slotEntry.cardName = card.name;
  slotEntry.type = card.type;
  slotEntry.fit = fitsSlot;
  slotEntry.landed = landed;
  slotEntry.result = resultLabel;
  slotEntry.offense = createSequenceCardState(
    slotEntry.offense?.ownerKey || currentApp.state.currentTurn,
    card,
    resultLabel,
    { fit: fitsSlot }
  );

  if (landed) {
    currentApp.state.sequence.successfulSlots += 1;
  } else {
    currentApp.state.sequence.comboEligible = false;
  }

  if (!fitsSlot) {
    currentApp.state.sequence.comboEligible = false;
  }
}

function resumeTurnFlow(currentApp) {
  if (!currentApp.state || currentApp.state.isGameOver) {
    renderApp(currentApp);
    return;
  }

  renderApp(currentApp);

  if (currentApp.state.sequence.totalPlayed >= MAX_SEQUENCE_SLOTS) {
    if (currentApp.state.currentTurn === "enemy") {
      queuePendingStep(
        currentApp,
        `Defending ${currentApp.state.enemy.name}'s turn`,
        "Sequence complete. End the turn to continue.",
        [
          {
            label: "End Turn",
            onClick: () => {
              finishTurn(currentApp);
            }
          }
        ]
      );
    }
    return;
  }

  if (currentApp.state.currentTurn === "enemy") {
    queueEnemyTurnStep(currentApp);
  }
}

function finishTurn(currentApp) {
  const { state } = currentApp;

  if (!state || state.isGameOver || state.pendingDefense || state.pendingCoin || state.pinAttempt) {
    return;
  }

  const attackerKey = state.currentTurn;
  const defenderKey = getOpponentKey(attackerKey);
  const attacker = state[attackerKey];
  const defender = state[defenderKey];

  if (
    state.sequence.comboEligible &&
    state.sequence.totalPlayed === MAX_SEQUENCE_SLOTS &&
    state.sequence.successfulSlots === MAX_SEQUENCE_SLOTS
  ) {
    addCardsToPinfallDeck(defender, "Fail", 1);
    addMatchLog(currentApp, `${attacker.name} completes a combo. ${defender.name} gains 1 Fail card.`);
  }

  if (attacker.stunned) {
    attacker.stunned = false;
    addMatchLog(currentApp, `${attacker.name} shakes off the stun at end of turn.`);
  }

  if (attacker.exhaustionPendingLoss) {
    endMatch(
      currentApp,
      attackerKey === "player" ? "lose" : "win",
      `${attacker.name} runs out of maneuver cards and loses by deck exhaustion.`
    );
    return;
  }

  addMatchLog(currentApp, `${attacker.name}'s turn ends.`);
  state.turnNumber += 1;
  beginTurn(currentApp, defenderKey);
}

function getOpponentKey(wrestlerKey) {
  return wrestlerKey === "player" ? "enemy" : "player";
}

function doesCardFitSlot(card, slot) {
  return card.slot === "any" || card.slot === slot;
}

function countPinfallPressure(card, cardType) {
  return (card.effects || []).reduce((total, effect) => {
    if (effect.type === "pinfall" && effect.card === cardType) {
      return total + effect.amount;
    }

    return total;
  }, 0);
}

function hasEffectType(card, effectType) {
  return (card.effects || []).some((effect) => effect.type === effectType);
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function shuffleArray(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }

  return items;
}

function scheduleCall(currentApp, delay, callback) {
  const timeoutId = window.setTimeout(() => {
    currentApp.timers.delete(timeoutId);
    callback();
  }, delay);

  currentApp.timers.add(timeoutId);
}

function clearScheduledCalls(currentApp) {
  currentApp.timers.forEach((timeoutId) => {
    window.clearTimeout(timeoutId);
  });

  currentApp.timers.clear();
}

function addMatchLog(currentApp, message) {
  if (!message) {
    return;
  }

  currentApp.state.matchLog.push(message);
  currentApp.state.shouldScrollLog = true;
}

function addMatchLogLines(currentApp, messages) {
  messages.forEach((message) => addMatchLog(currentApp, message));
}

function pluralize(word, count) {
  return count === 1 ? word : `${word}s`;
}

function endMatch(currentApp, outcome, message) {
  clearScheduledCalls(currentApp);

  currentApp.state.isGameOver = true;
  currentApp.state.outcome = outcome;
  currentApp.state.pendingDefense = null;
  currentApp.state.pendingCoin = null;
  currentApp.state.pinAttempt = null;
  currentApp.state.statusMessage = message;
  addMatchLog(currentApp, message);
  renderApp(currentApp);
}

function renderApp(currentApp) {
  if (!currentApp.state) {
    return;
  }

  renderDirector(currentApp);
  renderSequence(currentApp.state);
  renderActionPanel(currentApp.state);
  renderWrestlerPanel(currentApp.state, "player", dom.wrestlerPanels.player);
  renderWrestlerPanel(currentApp.state, "enemy", dom.wrestlerPanels.enemy);
  renderHand(currentApp);
  renderRecentEvents(currentApp.state);
  renderMatchLog(currentApp.state);
}

function renderDirector(currentApp) {
  const { state } = currentApp;

  if (!state) {
    return;
  }

  const attackerKey = state.currentTurn;
  const attacker = state[attackerKey];
  const slotLabel =
    state.sequence.totalPlayed >= MAX_SEQUENCE_SLOTS
      ? "Sequence done"
      : `Slot ${state.sequence.nextSlot} of ${MAX_SEQUENCE_SLOTS}`;

  dom.directorTitle.textContent = `${attacker.name} / ${slotLabel}`;
  dom.directorSubtitle.textContent = buildDirectorSubtitle(state);
  dom.directorPrimary.hidden = true;
  dom.directorPrimary.textContent = "";
  dom.directorPrimary.onclick = null;
  dom.directorPrimary.disabled = false;

  if (state.isGameOver) {
    dom.outcomeBanner.hidden = false;
    dom.outcomeBanner.textContent = state.outcome === "win" ? "You win" : "You lose";
    dom.outcomeBanner.className =
      state.outcome === "win"
        ? "outcome-banner outcome-banner--win"
        : "outcome-banner outcome-banner--lose";
  } else {
    dom.outcomeBanner.hidden = true;
    dom.outcomeBanner.className = "outcome-banner";
  }
}

function buildDirectorSubtitle(state) {
  if (state.isGameOver) {
    return state.statusMessage || "Match over.";
  }

  if (state.pendingStep) {
    return state.pendingStep.text || "Next step.";
  }

  if (state.pendingCoin) {
    return "Call it and flip.";
  }

  if (state.pendingDefense) {
    return "Choose a response.";
  }

  if (state.pinAttempt) {
    return "Pin in progress.";
  }

  if (state.sequence.totalPlayed >= MAX_SEQUENCE_SLOTS) {
    return "End turn.";
  }

  return "Play the next card.";
}

function buildDirectorPrimaryAction(state) {
  if (state.isGameOver) {
    return null;
  }

  if (state.pendingStep && state.pendingStep.buttons.length > 0) {
    return state.pendingStep.buttons[0];
  }

  if (state.pendingCoin && state.pendingCoin.phase === "reveal") {
    return {
      label: "Flip Coins",
      onClick: resolvePendingCoin
    };
  }

  if (state.pinAttempt && !state.pinAttempt.pendingOutcome) {
    return {
      label: "Draw Next Pinfall Card",
      onClick: () => resolveNextPinDraw(app)
    };
  }

  if (canPlayerEndTurn(state)) {
    return {
      label: "End Turn",
      onClick: () => finishTurn(app)
    };
  }

  return null;
}

function renderSequence(state) {
  if (!dom.sequenceCombo) {
    return;
  }

  const activeSlot = getActiveSequenceSlot(state);
  dom.sequenceCombo.textContent = state.sequence.comboEligible
    ? `Combo ${state.sequence.successfulSlots} / ${MAX_SEQUENCE_SLOTS} landed`
    : "Combo broken";
  dom.sequenceSlots.replaceChildren();

  state.sequence.slots.forEach((slotEntry) => {
    dom.sequenceSlots.appendChild(buildSequenceSlot(state, slotEntry, activeSlot));
  });
}

function buildSequenceSlot(state, slotEntry, activeSlot) {
  const model = buildSequenceSlotModel(state, slotEntry);
  const slot = document.createElement("article");

  slot.className = [
    "sequence-slot",
    activeSlot === slotEntry.slot && !state.isGameOver ? "sequence-slot--current" : "",
    slotEntry.landed ? "sequence-slot--success" : "",
    slotEntry.cardName && !slotEntry.landed ? "sequence-slot--stopped" : "",
    slotEntry.cardName && !slotEntry.fit ? "sequence-slot--offslot" : ""
  ]
    .filter(Boolean)
    .join(" ");

  const slotNumber = document.createElement("p");
  slotNumber.className = "sequence-slot__number";
  slotNumber.textContent = `Slot ${slotEntry.slot}`;
  slot.appendChild(slotNumber);

  const card = document.createElement("div");
  card.className = ["sequence-card", model.empty ? "sequence-card--empty" : ""].filter(Boolean).join(" ");
  slot.appendChild(card);

  if (model.type) {
    const type = document.createElement("p");
    type.className = "sequence-slot__type";
    type.textContent = model.type;
    card.appendChild(type);
  }

  const title = document.createElement("h3");
  title.className = "sequence-slot__title";
  title.textContent = model.title;
  card.appendChild(title);

  if (model.meta) {
    const meta = document.createElement("p");
    meta.className = "sequence-slot__meta";
    meta.textContent = model.meta;
    card.appendChild(meta);
  }

  if (model.result) {
    const result = document.createElement("p");
    result.className = "sequence-slot__result";
    result.textContent = model.result;
    card.appendChild(result);
  }

  return slot;
}

function buildSequenceSlotModel(state, slotEntry) {
  const liveCard = slotEntry.offense;

  if (slotEntry.cardName || liveCard) {
    const isResolved = Boolean(slotEntry.cardName);
    return {
      empty: false,
      type: capitalize(slotEntry.type || liveCard?.type || ""),
      title: slotEntry.cardName || liveCard.cardName,
      meta: isResolved ? "" : liveCard?.result || "",
      result: isResolved && slotEntry.result && slotEntry.result !== "Open" ? slotEntry.result : ""
    };
  }

  const isCurrentSlot = slotEntry.slot === state.sequence.nextSlot && state.sequence.totalPlayed < MAX_SEQUENCE_SLOTS;
  const responsePending =
    (state.pendingDefense && state.pendingDefense.context.slot === slotEntry.slot) ||
    (state.pendingCoin && state.pendingCoin.context.slot === slotEntry.slot);

  if (isCurrentSlot) {
    if (responsePending) {
      return {
        empty: true,
        title: "Resolving",
        meta: "Waiting on the answer.",
        result: ""
      };
    }

    return {
      empty: true,
      title: state.currentTurn === "player" ? "Awaiting card" : "Reveal card",
      meta: state.currentTurn === "player" ? "Play a card" : "Enemy is choosing",
      result: ""
    };
  }

  if (slotEntry.slot > state.sequence.nextSlot) {
    return {
      empty: true,
      title: "Locked",
      meta: "Awaiting previous slot",
      result: ""
    };
  }

  return {
    empty: true,
    title: "Open",
    meta: "",
    result: ""
  };
}

function getActiveSequenceSlot(state) {
  if (state.pendingDefense?.context.slot) {
    return state.pendingDefense.context.slot;
  }

  if (state.pendingCoin?.context.slot) {
    return state.pendingCoin.context.slot;
  }

  if (state.pinAttempt?.slot) {
    return state.pinAttempt.slot;
  }

  if (state.sequence.totalPlayed < MAX_SEQUENCE_SLOTS) {
    return state.sequence.nextSlot;
  }

  return null;
}

function renderActionPanel(state) {
  const model = buildActionModel(state);

  dom.actionTitle.textContent = model.title;
  dom.actionText.textContent = model.text;
  dom.actionOutcome.textContent = model.outcome || "";
  dom.actionOutcome.hidden = !model.outcome;
  dom.actionPhase.textContent = model.phase || "";
  dom.actionPhase.hidden = !model.phase;
  dom.actionButtons.replaceChildren();

  model.buttons.forEach((buttonModel) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `action-button ${buttonModel.tone || "action-button--default"}`;
    button.textContent = buttonModel.label;
    button.disabled = Boolean(buttonModel.disabled);
    button.addEventListener("click", buttonModel.onClick);
    dom.actionButtons.appendChild(button);
  });

  dom.actionButtons.hidden = model.buttons.length === 0;

  dom.endTurnButton.disabled = !canPlayerEndTurn(state);
  dom.endTurnButton.hidden = state.currentTurn !== "player" || state.isGameOver;
}

function buildActionModel(state) {
  if (state.isGameOver) {
    return {
      title: "Match Over",
      text: state.statusMessage,
      outcome: "Reset to play again.",
      phase: "",
      buttons: []
    };
  }

  if (state.pendingStep) {
    return {
      title: state.pendingStep.title,
      text: state.pendingStep.text,
      outcome: "",
      phase: "",
      buttons: state.pendingStep.buttons
    };
  }

  if (state.pendingCoin && state.pendingCoin.actorKey === "player" && state.pendingCoin.phase === "call") {
    const coinMode = getCoinMode(app, state.pendingCoin.context);
    return {
      title: state.pendingCoin.defenseCard.name,
      text: `Call it for your ${capitalize(state.pendingCoin.defenseCard.type)}.`,
      outcome: coinModeInstruction(coinMode),
      phase: "",
      buttons: COIN_SIDES.map((side) => {
        return {
          label: side,
          onClick: () => resolvePlayerCoinCall(side)
        };
      })
    };
  }

  if (state.pendingCoin && state.pendingCoin.phase === "reveal") {
    const actor = state[state.pendingCoin.actorKey];
    const coinMode = getCoinMode(app, state.pendingCoin.context);

    return {
      title: "Coin Toss",
      text: `${actor.name} calls ${state.pendingCoin.call}.`,
      outcome: coinModeInstruction(coinMode),
      phase: "",
      buttons: [
        {
          label: "Flip Coins",
          onClick: resolvePendingCoin
        }
      ]
    };
  }

  if (state.pendingDefense && state.pendingDefense.context.defenderKey === "player") {
    const isPin = state.pendingDefense.kind === "pin";
    const card = state.pendingDefense.context.card;
    const detail =
      card.type === "attack"
        ? `${card.damage} damage.`
        : card.type === "taunt"
          ? "Answer it or let it through."
          : "Answer it or go to the count.";
    return {
      title: state.pendingDefense.context.card.name,
      text: detail,
      outcome: isPin
        ? "Miss it and the count starts."
        : "",
      phase: "",
      buttons: [
        {
          label: isPin ? "Take the count" : "Let it land",
          tone: "action-button--ghost",
          onClick: passPlayerDefense
        }
      ]
    };
  }

  if (state.pinAttempt) {
    const defender = state[state.pinAttempt.defenderKey];

    if (state.pinAttempt.pendingOutcome === "kickout") {
      return {
        title: "Kickout",
        text: `${defender.name} slips out.`,
        outcome: "",
        phase: "",
        buttons: [
          {
            label: "Continue",
            onClick: () => {
              finishFailedPin(app);
            }
          }
        ]
      };
    }

    if (state.pinAttempt.pendingOutcome === "fall") {
      return {
        title: "Three Count",
        text: `${defender.name} draws three straight Fails.`,
        outcome: "",
        phase: "",
        buttons: [
          {
            label: "Finish Match",
            onClick: () => {
              finishSuccessfulPin(app);
            }
          }
        ]
      };
    }

    return {
      title: "Count",
      text: `Draw up to ${PIN_DRAW_COUNT} from the pin deck.`,
      outcome: "Kickout escapes. Three Fails ends it.",
      phase: "",
      buttons: [
        {
          label: "Draw Next Card",
          onClick: () => {
            resolveNextPinDraw(app);
          }
        }
      ]
    };
  }

  if (state.currentTurn === "player") {
    const hasOffense = state.player.hand.some((card) => OFFENSIVE_TYPES.has(card.type));
    const title =
      state.sequence.totalPlayed >= MAX_SEQUENCE_SLOTS
        ? "Sequence Complete"
        : `Slot ${state.sequence.nextSlot} / ${MAX_SEQUENCE_SLOTS}`;

    return {
      title,
      text: hasOffense
        ? "Play a card into this slot."
        : "No offense in hand.",
      outcome: hasOffense
        ? ""
        : "End turn when ready.",
      phase: "",
      buttons: []
    };
  }

  return {
    title: "Defending",
    text: `${state.enemy.name} is up.`,
    outcome: "Dodge or reverse when a card shows.",
    phase: "",
    buttons: []
  };
}

function coinModeInstruction(coinMode) {
  if (coinMode === "easy") {
    return "Two flips. One match is enough.";
  }

  if (coinMode === "hard") {
    return "Two flips. Both must match.";
  }

  return "One flip decides it.";
}

function resolvePlayerCoinCall(side) {
  const pendingCoin = app.state.pendingCoin;

  if (!pendingCoin) {
    return;
  }

  app.state.pendingCoin = {
    ...pendingCoin,
    phase: "reveal",
    call: side
  };
  app.state.statusMessage = `${app.state.player.name} calls ${side}.`;
  renderApp(app);
}

function resolvePendingCoin() {
  const pendingCoin = app.state.pendingCoin;

  if (!pendingCoin || pendingCoin.phase !== "reveal") {
    return;
  }

  app.state.pendingCoin = null;
  resolveDefenseAttempt(app, pendingCoin.context, pendingCoin.defenseCard, pendingCoin.call);
}

function passPlayerDefense() {
  const pendingDefense = app.state.pendingDefense;

  if (!pendingDefense) {
    return;
  }

  app.state.pendingDefense = null;

  if (pendingDefense.kind === "pin") {
    startPinfallAttempt(app, pendingDefense.context.pinContext);
    return;
  }

  resolveOffensiveCardWithoutDefense(app, pendingDefense.context);
}

function renderWrestlerPanel(state, wrestlerKey, panelDom) {
  const wrestler = state[wrestlerKey];
  const pinSummary = getPinfallSummary(wrestler);
  const pinChance = calculatePinChance(pinSummary.fail, pinSummary.total);
  const isAttacker = state.currentTurn === wrestlerKey;
  const roleLabel = isAttacker ? "Attacker" : "Defender";

  panelDom.name.textContent = wrestler.name;
  panelDom.role.textContent = roleLabel;
  panelDom.role.classList.toggle("role-chip--attacker", isAttacker);
  panelDom.role.classList.toggle("role-chip--defender", !isAttacker);
  panelDom.stats.textContent = `Dmg ${wrestler.accumulatedDamage} | Hand ${wrestler.hand.length} | Deck ${wrestler.maneuverDeck.length}`;
  panelDom.pin.textContent = `Pin ${pinSummary.fail} Fail / ${pinSummary.kickout} Kickout | ${formatPercent(
    pinChance
  )}`;
  const statusLine = buildWrestlerStatusLine(wrestler);
  panelDom.status.textContent = statusLine || "";
  panelDom.status.hidden = !statusLine;
  panelDom.card.dataset.state = pickPanelState(wrestler, pinChance);
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

  return { total: wrestler.pinfallDeck.length, fail, kickout };
}

function buildWrestlerStatusLine(wrestler) {
  const flags = [];

  if (wrestler.stunned) {
    flags.push("Stunned");
  }

  if (wrestler.exhaustionPendingLoss) {
    flags.push("Must win this turn");
  }

  return flags.length > 0 ? `Status: ${flags.join(" / ")}` : "";
}

function pickPanelState(wrestler, pinChance) {
  if (wrestler.exhaustionPendingLoss || pinChance >= 0.35) {
    return "danger";
  }

  if (wrestler.stunned || pinChance >= 0.18) {
    return "warning";
  }

  return "steady";
}

function pickPressureColor(pinChance) {
  if (pinChance >= 0.35) {
    return "#da3a64";
  }

  if (pinChance >= 0.18) {
    return "#f09a2a";
  }

  return "#12a6c8";
}

function calculatePinChance(failCount, totalCount) {
  if (failCount < PIN_DRAW_COUNT || totalCount < PIN_DRAW_COUNT) {
    return 0;
  }

  let chance = 1;

  for (let drawIndex = 0; drawIndex < PIN_DRAW_COUNT; drawIndex += 1) {
    chance *= (failCount - drawIndex) / (totalCount - drawIndex);
  }

  return chance;
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function renderHand(currentApp) {
  const { state } = currentApp;
  const player = state.player;
  const filter = app.ui.handFilter || "usable";

  dom.drawPileCount.textContent = `Deck ${player.maneuverDeck.length} | Discard ${player.discardPile.length}`;
  dom.handCards.replaceChildren();

  if (player.hand.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "empty-state";
    emptyState.textContent = "Hand is empty.";
    dom.handCards.appendChild(emptyState);
    return;
  }

  const entries = player.hand.map((card, handIndex) => {
    const mode = getPlayerHandMode(state, card);
    return { card, handIndex, mode, category: getCardCategory(card) };
  });

  const filtered = entries.filter((entry) => {
    if (filter === "all") {
      return true;
    }

    if (filter === "usable") {
      return entry.mode.clickable;
    }

    if (filter === "offense") {
      return OFFENSIVE_TYPES.has(entry.card.type);
    }

    if (filter === "defense") {
      return DEFENSIVE_TYPES.has(entry.card.type);
    }

    if (filter === "pin") {
      return entry.card.type === "pin";
    }

    return true;
  });

  const ordered = sortHandEntries(state, filtered);

  if (ordered.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "empty-state";
    emptyState.textContent = filter === "usable" ? "No playable cards." : "Nothing here.";
    dom.handCards.appendChild(emptyState);
    return;
  }

  ordered.forEach(({ card, handIndex, mode }) => {
    const button = document.createElement("button");

    button.type = "button";
    button.className = [
      "hand-card",
      `hand-card--${card.type}`,
      mode.clickable ? "hand-card--live" : "",
      !mode.clickable ? "hand-card--inactive" : "",
      mode.offSlot ? "hand-card--offslot" : "",
      mode.validSlot ? "hand-card--valid" : ""
    ]
      .filter(Boolean)
      .join(" ");
    button.dataset.handIndex = String(handIndex);
    button.setAttribute("aria-disabled", mode.clickable ? "false" : "true");
    button.innerHTML = `
      <div class="hand-card__front">
        <span class="hand-card__type hand-card__type--${card.type}">${capitalize(card.type)}</span>
        <span class="hand-card__title">${card.name}</span>
        <span class="hand-card__value">${formatCardPrimaryValue(card)}</span>
        <span class="hand-card__label">${formatCardPrimaryLabel(card)}</span>
      </div>
    `;

    button.addEventListener("click", () => {
      openCardModal(currentApp, { card, handIndex, mode });
    });

    dom.handCards.appendChild(button);
  });
}

function getPlayerHandMode(state, card) {
  if (state.isGameOver || state.pendingCoin || state.pinAttempt) {
    return { clickable: false, reason: "Finish the current step." };
  }

  if (state.pendingDefense && state.pendingDefense.context.defenderKey === "player") {
    return DEFENSIVE_TYPES.has(card.type)
      ? { clickable: true }
      : { clickable: false, reason: "Save this for your turn." };
  }

  if (state.currentTurn !== "player") {
    return DEFENSIVE_TYPES.has(card.type)
      ? { clickable: false, reason: "Wait for a response window." }
      : { clickable: false, reason: "Wait for your turn." };
  }

  if (state.sequence.totalPlayed >= MAX_SEQUENCE_SLOTS) {
    return { clickable: false, reason: "End the turn first." };
  }

  if (!OFFENSIVE_TYPES.has(card.type)) {
    return { clickable: false, reason: "Hold this for defense." };
  }

  const fitsSlot = doesCardFitSlot(card, state.sequence.nextSlot);

  return fitsSlot
    ? { clickable: true, validSlot: true }
    : { clickable: true, offSlot: true, reason: "Off-slot." };
}

function getCardCategory(card) {
  if (card.type === "pin") {
    return "pin";
  }

  if (DEFENSIVE_TYPES.has(card.type)) {
    return "defense";
  }

  return "offense";
}

function sortHandEntries(state, entries) {
  const offenseOrder = ["attack", "taunt", "pin", "dodge", "reversal"];
  const defenseOrder = ["dodge", "reversal", "attack", "taunt", "pin"];
  const order = state.pendingDefense || state.currentTurn !== "player" ? defenseOrder : offenseOrder;

  return [...entries].sort((a, b) => {
    if (a.mode.clickable !== b.mode.clickable) {
      return a.mode.clickable ? -1 : 1;
    }

    return order.indexOf(a.card.type) - order.indexOf(b.card.type);
  });
}

function commitPlayerDefense(handIndex) {
  const pendingDefense = app.state.pendingDefense;

  if (!pendingDefense) {
    return;
  }

  const sourceRect = getPlaySourceRect("player", handIndex);
  const [defenseCard] = app.state.player.hand.splice(handIndex, 1);

  if (!defenseCard || !DEFENSIVE_TYPES.has(defenseCard.type)) {
    return;
  }

  app.state.player.discardPile.push(defenseCard);
  setSequenceDefenseCard(app.state, pendingDefense.context.slot, "player", defenseCard, "Readied");
  app.state.pendingDefense = null;
  app.state.pendingCoin = {
    phase: "call",
    actorKey: "player",
    context: pendingDefense.context,
    defenseCard
  };
  app.state.statusMessage = `${app.state.player.name} readies ${defenseCard.name}.`;
  renderApp(app);
  queueCardMotionEffect(sourceRect, pendingDefense.context.slot, "player", defenseCard, "Defense");
}

function renderMatchLog(state) {
  dom.matchLogList.replaceChildren();

  state.matchLog.forEach((entry) => {
    const item = document.createElement("li");
    item.textContent = entry;
    dom.matchLogList.appendChild(item);
  });

  if (state.shouldScrollLog) {
    state.shouldScrollLog = false;
  }
}

function renderRecentEvents(state) {
  const recent = state.matchLog.slice(-3);
  dom.recentEventsList.replaceChildren();

  if (recent.length === 0) {
    const item = document.createElement("li");
    item.textContent = "Nothing yet.";
    dom.recentEventsList.appendChild(item);
    return;
  }

  recent.forEach((entry) => {
    const item = document.createElement("li");
    item.textContent = entry;
    dom.recentEventsList.appendChild(item);
  });
}

function formatCardSlot(slot) {
  if (slot === "any") {
    return "Any slot";
  }

  if (!slot) {
    return "Defense";
  }

  return `Slot ${slot}`;
}

function formatCardPrimaryValue(card) {
  if (card.type === "attack") {
    return `${card.damage}`;
  }

  if (card.type === "taunt") {
    return "SETUP";
  }

  if (card.type === "pin") {
    return "COVER";
  }

  if (card.type === "dodge") {
    return `${card.missDamage || 0}`;
  }

  return `${card.reversalDamage || 0}`;
}

function formatCardPrimaryLabel(card) {
  if (card.type === "attack") {
    return "Damage";
  }

  if (card.type === "taunt") {
    return "Setup";
  }

  if (card.type === "pin") {
    return "Cover";
  }

  if (card.type === "dodge") {
    return "Slip";
  }

  return "Counter";
}

function openLogModal() {
  if (!dom.logModal) {
    return;
  }

  closeCardModal();
  dom.logModal.hidden = false;
  syncModalState();
}

function closeLogModal() {
  if (!dom.logModal) {
    return;
  }

  dom.logModal.hidden = true;
  syncModalState();
}

function openCardModal(currentApp, entry) {
  if (!dom.cardModal) {
    return;
  }

  const { state } = currentApp;
  const { card, handIndex, mode } = entry;
  const cardValue = `${formatCardPrimaryLabel(card)} ${formatCardPrimaryValue(card)}`;
  const cardReason = mode.reason || "";

  closeLogModal();
  dom.cardModalType.textContent = capitalize(card.type);
  dom.cardModalTitle.textContent = card.name;
  dom.cardModalMeta.textContent = formatCardSlot(card.slot);
  dom.cardModalValue.textContent = cardValue;
  dom.cardModalReason.textContent = cardReason;
  dom.cardModalReason.hidden = !cardReason;
  dom.cardModalEffect.textContent = describeCard(card);

  if (mode.clickable) {
    dom.cardModalAction.hidden = false;
    dom.cardModalAction.disabled = false;
    dom.cardModalAction.textContent =
      state.pendingDefense && state.pendingDefense.context.defenderKey === "player"
        ? `Play ${capitalize(card.type)}`
        : `Use ${card.name}`;
    dom.cardModalAction.onclick = () => {
      closeCardModal();

      if (state.pendingDefense && state.pendingDefense.context.defenderKey === "player") {
        commitPlayerDefense(handIndex);
        return;
      }

      if (state.currentTurn === "player") {
        playOffensiveCard(currentApp, "player", handIndex);
      }
    };
  } else {
    dom.cardModalAction.hidden = true;
    dom.cardModalAction.disabled = true;
    dom.cardModalAction.textContent = "Play Card";
    dom.cardModalAction.onclick = null;
  }

  dom.cardModal.hidden = false;
  syncModalState();
}

function closeCardModal() {
  if (!dom.cardModal) {
    return;
  }

  dom.cardModal.hidden = true;
  if (dom.cardModalAction) {
    dom.cardModalAction.onclick = null;
  }
  syncModalState();
}

function syncModalState() {
  const anyModalOpen =
    (dom.logModal && !dom.logModal.hidden) ||
    (dom.cardModal && !dom.cardModal.hidden);
  document.body.classList.toggle("modal-open", Boolean(anyModalOpen));
}

function describeCard(card) {
  const details = [];

  if (card.type === "attack" && card.missDamage) {
    details.push(`Miss leaves ${card.missDamage} coming back.`);
  }

  if (card.type === "dodge") {
    details.push(`Call it right and they whiff for ${card.missDamage || 0}.`);
  }

  if (card.type === "reversal") {
    details.push(`Call it right and send ${card.reversalDamage || 0} back.`);
  }

  (card.effects || []).forEach((effect) => {
    if (effect.type === "pinfall") {
      details.push(`${effect.target === "self" ? "You" : "They"} get +${effect.amount} ${effect.card}.`);
      return;
    }

    if (effect.type === "stun") {
      details.push(`${effect.target === "self" ? "You are" : "They are"} stunned next turn.`);
    }
  });

  if (card.immediatePin) {
    details.push("Flows straight into a cover.");
  }

  if (details.length === 0) {
    return card.type === "pin" ? "Quick cover." : "Simple and clean.";
  }

  return details.join(" / ");
}

function formatRarity(rarity) {
  const icons = { common: "â—", uncommon: "â—†", rare: "â˜…", special: "â‹" };
  return `${icons[rarity] || "â€¢"} ${capitalize(rarity)}`;
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function coinModeLabel(coinMode) {
  if (coinMode === "easy") {
    return "defense advantage";
  }

  if (coinMode === "hard") {
    return "defense disadvantage";
  }

  return "normal odds";
}

