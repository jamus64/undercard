const Engine = window.UnderCardEngine;

if (!Engine) {
  throw new Error("UnderCardEngine failed to load.");
}

const DEFAULT_PLAYER_WRESTLER = "Jamie 'The Best Wrestler & Fit' Wyatt";
const RARITY_LIMITS = { common: 4, uncommon: 3, rare: 2, special: 1 };
const AI_STEP_DELAY = 1000;

const DATA_FILES = {
  cardPool: "data/card-pool.json",
  deckRecipe: "data/deck-recipe.json",
  wrestlers: "data/wrestlers.json"
};

const gameData = {
  cardPool: [],
  cardLookup: {},
  deckRecipe: [],
  wrestlers: []
};

const app = {
  isReady: false,
  state: null,
  ui: {
    handFilter: "usable"
  },
  timers: new Set()
};

const dom = {
  appContent: document.getElementById("app-content"),
  startupError: document.getElementById("startup-error"),
  restartButton: document.getElementById("restart-button"),
  fullLogButton: document.getElementById("full-log-button"),
  closeLogButton: document.getElementById("close-log-button"),
  logModal: document.getElementById("log-modal"),
  logModalBackdrop: document.querySelector("#log-modal .log-modal__backdrop"),
  matchLogList: document.getElementById("match-log-list"),
  closeCardButton: document.getElementById("close-card-button"),
  cardModal: document.getElementById("card-modal"),
  cardModalBackdrop: document.querySelector("#card-modal .card-modal__backdrop"),
  cardModalType: document.getElementById("card-modal-type"),
  cardModalTitle: document.getElementById("card-modal-title"),
  cardModalMeta: document.getElementById("card-modal-meta"),
  cardModalValue: document.getElementById("card-modal-value"),
  cardModalReason: document.getElementById("card-modal-reason"),
  cardModalEffect: document.getElementById("card-modal-effect"),
  cardModalAction: document.getElementById("card-modal-action"),
  directorTitle: document.getElementById("director-title"),
  directorSubtitle: document.getElementById("director-subtitle"),
  directorPrimary: document.getElementById("director-primary"),
  outcomeBanner: document.getElementById("outcome-banner"),
  sequenceCombo: document.getElementById("sequence-combo"),
  sequenceSlots: document.getElementById("sequence-slots"),
  actionTitle: document.getElementById("action-title"),
  actionText: document.getElementById("action-text"),
  actionOutcome: document.getElementById("action-outcome"),
  actionPhase: document.getElementById("action-phase"),
  actionButtons: document.getElementById("action-buttons"),
  actionPanel: document.querySelector(".action-panel"),
  handCards: document.getElementById("hand-cards"),
  handFilters: document.getElementById("hand-filters"),
  drawPileCount: document.getElementById("draw-pile-count"),
  playerPinSummary: document.getElementById("player-pin-summary"),
  endTurnButton: document.getElementById("end-turn-button"),
  recentEventsList: document.getElementById("recent-events-list"),
  wrestlerPanels: {
    player: {
      card: document.getElementById("player-summary"),
      name: document.getElementById("player-name"),
      role: document.getElementById("player-role"),
      stats: document.getElementById("player-stats"),
      pin: document.getElementById("player-pin"),
      status: document.getElementById("player-status")
    },
    enemy: {
      card: document.getElementById("enemy-summary"),
      name: document.getElementById("enemy-name"),
      role: document.getElementById("enemy-role"),
      stats: document.getElementById("enemy-stats"),
      pin: document.getElementById("enemy-pin"),
      status: document.getElementById("enemy-status")
    }
  }
};

bindEvents();
boot();

function bindEvents() {
  dom.restartButton?.addEventListener("click", restartMatch);
  dom.fullLogButton?.addEventListener("click", openLogModal);
  dom.closeLogButton?.addEventListener("click", closeLogModal);
  dom.logModalBackdrop?.addEventListener("click", closeLogModal);
  dom.closeCardButton?.addEventListener("click", closeCardModal);
  dom.cardModalBackdrop?.addEventListener("click", closeCardModal);

  dom.endTurnButton?.addEventListener("click", () => {
    if (!canPlayerStopEarly(app.state)) {
      return;
    }

    Engine.stopTurn(app.state);
    refreshApp();
  });

  dom.handFilters?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const filter = target.getAttribute("data-filter");
    if (!filter) {
      return;
    }

    app.ui.handFilter = filter;
    syncHandFilterChips(filter);
    renderHand(app);
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
}

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

    const deck = Engine.buildDeckForWrestler(wrestler, gameData.cardLookup, gameData.deckRecipe);
    validateDeckForWrestler(deck, wrestler.name);
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
    const limit = RARITY_LIMITS[card.rarity] || 1;
    if (count > limit) {
      throw new Error(`${wrestlerName}'s deck exceeds ${card.name}'s copy limit.`);
    }
  });
}

function renderStartupError(error) {
  console.error(error);
  dom.appContent.hidden = true;
  dom.startupError.hidden = false;
  dom.startupError.innerHTML = `
    <h2>Unable to load game data</h2>
    <p>Check the browser console and confirm the local JSON files are available.</p>
    <p class="startup-error__detail">${error.message}</p>
  `;
}

function restartMatch() {
  if (!app.isReady) {
    return;
  }

  startMatch(app);
}

function startMatch(currentApp) {
  clearScheduledCalls(currentApp);
  closeCardModal();
  closeLogModal();
  resetHandFilter("usable");

  const matchup = pickRandomMatchup();
  currentApp.state = Engine.createMatch({
    player: {
      name: matchup.player.name,
      maneuverDeck: Engine.buildDeckForWrestler(matchup.player, gameData.cardLookup, gameData.deckRecipe),
      shuffleManeuverDeck: true
    },
    enemy: {
      name: matchup.enemy.name,
      maneuverDeck: Engine.buildDeckForWrestler(matchup.enemy, gameData.cardLookup, gameData.deckRecipe),
      shuffleManeuverDeck: true
    }
  });

  refreshApp();
}

function pickRandomMatchup() {
  const roster = gameData.wrestlers;
  const playerTemplate =
    roster.find((wrestler) => wrestler.name === DEFAULT_PLAYER_WRESTLER) || roster[0];
  const enemyPool = roster.filter((wrestler) => wrestler.name !== playerTemplate.name);
  const enemyTemplate =
    enemyPool[Math.floor(Math.random() * enemyPool.length)] || playerTemplate;

  return {
    player: cloneWrestler(playerTemplate),
    enemy: cloneWrestler(enemyTemplate)
  };
}

function cloneWrestler(wrestler) {
  return {
    name: wrestler.name,
    signature: { ...wrestler.signature, onHitEffects: cloneEffects(wrestler.signature.onHitEffects) },
    finisher: { ...wrestler.finisher, onHitEffects: cloneEffects(wrestler.finisher.onHitEffects) }
  };
}

function cloneEffects(effects) {
  return Array.isArray(effects) ? effects.map((effect) => ({ ...effect })) : [];
}

function refreshApp() {
  renderApp(app);
  maybeRunAiFlow();
}

function maybeRunAiFlow() {
  clearScheduledCalls(app);

  if (!app.state || app.state.match.over) {
    return;
  }

  if (app.state.phase === Engine.PHASES.TURN_END) {
    scheduleCall(app, AI_STEP_DELAY, () => {
      if (!app.state || app.state.match.over || app.state.phase !== Engine.PHASES.TURN_END) {
        return;
      }

      Engine.continueAfterTurnEnd(app.state);
      refreshApp();
    });
    return;
  }

  if (app.state.phase === Engine.PHASES.PINFALL_DRAW) {
    return;
  }

  if (app.state.phase === Engine.PHASES.CHOOSE_NEXT_ACTION && app.state.turn.attackerKey === "enemy") {
    scheduleCall(app, AI_STEP_DELAY, runEnemyOffenseStep);
    return;
  }

  if (!app.state.resolution || app.state.resolution.defenderKey !== "enemy") {
    return;
  }

  if (
    (app.state.phase === Engine.PHASES.RESOLVE_ATTACK ||
      app.state.phase === Engine.PHASES.PIN_DEFENCE_DECISION) &&
    app.state.resolution.awaitingDefenceChoice
  ) {
    scheduleCall(app, AI_STEP_DELAY, runEnemyDefenseStep);
  }
}

function runEnemyOffenseStep() {
  if (!app.state || app.state.match.over || app.state.turn.attackerKey !== "enemy") {
    return;
  }

  const decision = Engine.chooseAiOffence(app.state, "enemy");

  if (decision.type === "stop") {
    Engine.stopTurn(app.state);
    refreshApp();
    return;
  }

  Engine.playOffensiveCard(app.state, decision.handIndex, "enemy");
  refreshApp();
}

function runEnemyDefenseStep() {
  if (
    !app.state ||
    app.state.match.over ||
    !app.state.resolution ||
    app.state.resolution.defenderKey !== "enemy" ||
    !app.state.resolution.awaitingDefenceChoice
  ) {
    return;
  }

  const decision = Engine.chooseAiDefence(app.state);

  if (decision.type === "none") {
    Engine.chooseNoDefence(app.state);
    refreshApp();
    return;
  }

  Engine.prepareDefence(app.state, decision.handIndex);
  renderApp(app);

  scheduleCall(app, AI_STEP_DELAY, () => {
    if (!app.state || !app.state.resolution || !app.state.resolution.awaitingCoinCall) {
      return;
    }

    Engine.callDefenceCoin(app.state, decision.call);
    refreshApp();
  });
}

function scheduleCall(currentApp, delay, callback) {
  const timeoutId = window.setTimeout(() => {
    currentApp.timers.delete(timeoutId);
    callback();
  }, delay);

  currentApp.timers.add(timeoutId);
}

function clearScheduledCalls(currentApp) {
  currentApp.timers.forEach((timeoutId) => window.clearTimeout(timeoutId));
  currentApp.timers.clear();
}

function renderApp(currentApp) {
  if (!currentApp.state) {
    return;
  }

  renderDirector(currentApp.state);
  renderSequence(currentApp.state);
  renderActionPanel(currentApp.state);
  renderWrestlerPanel(currentApp.state, "player", dom.wrestlerPanels.player);
  renderWrestlerPanel(currentApp.state, "enemy", dom.wrestlerPanels.enemy);
  renderHand(currentApp);
  renderRecentEvents(currentApp.state);
  renderMatchLog(currentApp.state);
}

function renderDirector(state) {
  const attacker = state.match.over ? null : Engine.getCurrentAttacker(state);
  const slotLabel = state.match.over
    ? "Match complete"
    : state.phase === Engine.PHASES.PINFALL_DRAW
      ? "Pinfall draw"
      : state.phase === Engine.PHASES.TURN_END
        ? "Turn ended"
      : `Slot ${Math.min(state.turn.nextSlot, 3)} of 3`;

  dom.directorTitle.textContent = attacker ? `${attacker.name} / ${slotLabel}` : "UnderCard / Match complete";
  dom.directorSubtitle.textContent = buildDirectorSubtitle(state);
  dom.directorPrimary.hidden = true;
  dom.directorPrimary.disabled = true;
  dom.directorPrimary.onclick = null;

  if (state.match.over) {
    dom.outcomeBanner.hidden = false;
    dom.outcomeBanner.textContent = state.match.winnerKey === "player" ? "You win" : "You lose";
    dom.outcomeBanner.className =
      state.match.winnerKey === "player"
        ? "outcome-banner outcome-banner--win"
        : "outcome-banner outcome-banner--lose";
    return;
  }

  dom.outcomeBanner.hidden = true;
  dom.outcomeBanner.className = "outcome-banner";
}

function buildDirectorSubtitle(state) {
  if (state.match.over) {
    return state.match.reason;
  }

  if (state.phase === Engine.PHASES.PINFALL_DRAW) {
    const pinned = state.players[state.pinAttempt.defenderKey];
    return `${pinned.name} draws pinfall cards one at a time.`;
  }

  if (state.phase === Engine.PHASES.TURN_END) {
    return state.status || lastLogLine(state);
  }

  if (state.phase === Engine.PHASES.RESOLVE_ATTACK && state.resolution?.awaitingDefenceChoice) {
    return `${state.players[state.resolution.defenderKey].name} chooses dodge, reversal, or no defence.`;
  }

  if (state.phase === Engine.PHASES.PIN_DEFENCE_DECISION && state.resolution?.awaitingDefenceChoice) {
    return `${state.players[state.resolution.defenderKey].name} chooses how to answer the pin.`;
  }

  if (state.phase === Engine.PHASES.CHOOSE_NEXT_ACTION) {
    return `${Engine.getCurrentAttacker(state).name} can play only into the next open slot.`;
  }

  return state.status || lastLogLine(state);
}

function renderSequence(state) {
  const activeSlot = getActiveSlot(state);
  const focusSlot = pickFocusSlot(state, activeSlot);

  dom.sequenceCombo.textContent = buildSequenceBanner(state);
  dom.sequenceSlots.replaceChildren();

  const track = document.createElement("div");
  track.className = "sequence-track";

  state.turn.slots.forEach((slotEntry) => {
    track.appendChild(buildSequenceTrackSlot(buildSequenceSlotModel(state, slotEntry, activeSlot), activeSlot));
  });

  dom.sequenceSlots.appendChild(track);
  dom.sequenceSlots.appendChild(buildSequenceFocusCard(buildSequenceSlotModel(state, focusSlot, activeSlot)));
}

function buildSequenceBanner(state) {
  if (state.match.over) {
    return "Match Over";
  }

  if (state.phase === Engine.PHASES.PINFALL_DRAW) {
    return `Pinfall ${state.pinAttempt.drawnCards.length} / ${Engine.constants.PIN_DRAW_COUNT}`;
  }

  if (state.phase === Engine.PHASES.TURN_END) {
    return "Turn ended";
  }

  if (state.turn.comboAchieved) {
    return "Combo success";
  }

  const played = state.turn.slots.filter((slot) => slot.card).length;
  const comboBroken =
    state.turn.playedPin ||
    state.turn.slots.some((slot) => {
      return slot.card && slot.result !== "Resolving" && !slot.countedForCombo;
    });

  if (comboBroken) {
    return "Combo broken";
  }

  return `Combo live ${played} / 3`;
}

function getActiveSlot(state) {
  if (state.pinAttempt) {
    return state.pinAttempt.slot;
  }

  if (state.resolution) {
    return state.resolution.slot;
  }

  if (state.turn.nextSlot <= 3) {
    return state.turn.nextSlot;
  }

  return 3;
}

function pickFocusSlot(state, activeSlot) {
  if (activeSlot && state.turn.slots[activeSlot - 1]) {
    return state.turn.slots[activeSlot - 1];
  }

  for (let index = state.turn.slots.length - 1; index >= 0; index -= 1) {
    if (state.turn.slots[index].card) {
      return state.turn.slots[index];
    }
  }

  return state.turn.slots[0];
}

function buildSequenceSlotModel(state, slotEntry, activeSlot) {
  const isCurrent = activeSlot === slotEntry.slot && !state.match.over;

  if (slotEntry.card) {
    const meta = [];

    if (slotEntry.card.type === "pin") {
      meta.push("Pin");
    } else {
      meta.push(slotEntry.onSlot ? "On-slot" : "Off-slot");
    }

    if (slotEntry.defence) {
      meta.push(formatDefenceSummary(slotEntry.defence));
    }

    if (slotEntry.destination) {
      meta.push(`To ${slotEntry.destination}`);
    }

    return {
      slot: slotEntry.slot,
      current: isCurrent,
      title: slotEntry.card.name,
      shortTitle: shortenCardName(slotEntry.card.name),
      type: capitalize(slotEntry.card.type),
      stateLabel: slotEntry.result,
      meta: meta.join(" / "),
      result: slotEntry.result,
      variant:
        slotEntry.onSlot === false
          ? "offslot"
          : slotEntry.countedForCombo || slotEntry.card.type === "pin"
            ? "success"
            : slotEntry.result === "Resolving"
              ? "live"
              : "stopped"
    };
  }

  if (slotEntry.slot === activeSlot) {
    return {
      slot: slotEntry.slot,
      current: true,
      title: state.turn.attackerKey === "player" ? "Choose card" : "Incoming",
      shortTitle: "Ready",
      type: "",
      stateLabel: state.turn.attackerKey === "player" ? "Your move" : "Enemy turn",
      meta: "Only the next sequential slot can be used.",
      result: "",
      variant: "live"
    };
  }

  return {
    slot: slotEntry.slot,
    current: false,
    title: slotEntry.slot < activeSlot ? "Open" : "Waiting",
    shortTitle: slotEntry.slot < activeSlot ? "Open" : "Locked",
    type: "",
    stateLabel: slotEntry.slot < activeSlot ? "Unused" : "Locked",
    meta: slotEntry.slot < activeSlot ? "No card played here." : "Waiting for the previous slot.",
    result: "",
    variant: slotEntry.slot < activeSlot ? "open" : "locked"
  };
}

function buildSequenceTrackSlot(model, activeSlot) {
  const slot = document.createElement("div");
  slot.className = [
    "sequence-track__slot",
    activeSlot === model.slot ? "sequence-track__slot--current" : "",
    model.variant ? `sequence-track__slot--${model.variant}` : ""
  ]
    .filter(Boolean)
    .join(" ");

  const number = document.createElement("span");
  number.className = "sequence-track__number";
  number.textContent = String(model.slot);
  slot.appendChild(number);

  const label = document.createElement("span");
  label.className = "sequence-track__label";
  label.textContent = model.shortTitle;
  slot.appendChild(label);

  return slot;
}

function buildSequenceFocusCard(model) {
  const card = document.createElement("article");
  card.className = [
    "sequence-focus",
    model.variant ? `sequence-focus--${model.variant}` : "",
    model.current ? "sequence-focus--current" : ""
  ]
    .filter(Boolean)
    .join(" ");

  const badge = document.createElement("p");
  badge.className = "sequence-focus__slot";
  badge.textContent = `Slot ${model.slot}`;
  card.appendChild(badge);

  const stateLine = document.createElement("p");
  stateLine.className = "sequence-focus__state";
  stateLine.textContent = model.stateLabel;
  card.appendChild(stateLine);

  if (model.type) {
    const type = document.createElement("p");
    type.className = "sequence-focus__type";
    type.textContent = model.type;
    card.appendChild(type);
  }

  const title = document.createElement("h3");
  title.className = "sequence-focus__title";
  title.textContent = model.title;
  card.appendChild(title);

  if (model.meta) {
    const meta = document.createElement("p");
    meta.className = "sequence-focus__meta";
    meta.textContent = model.meta;
    card.appendChild(meta);
  }

  if (model.result && model.result !== model.stateLabel) {
    const result = document.createElement("p");
    result.className = "sequence-focus__result";
    result.textContent = model.result;
    card.appendChild(result);
  }

  return card;
}

function renderActionPanel(state) {
  const model = buildActionModel(state);

  dom.actionTitle.textContent = model.title;
  dom.actionText.textContent = model.text;
  dom.actionPhase.textContent = model.phase || "";
  dom.actionPhase.hidden = !model.phase;
  dom.actionOutcome.textContent = model.outcome || "";
  dom.actionOutcome.hidden = !model.outcome;
  dom.actionButtons.replaceChildren();

  model.buttons.forEach((buttonModel) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `action-button ${buttonModel.tone || "action-button--primary"}`;
    button.textContent = buttonModel.label;
    button.disabled = Boolean(buttonModel.disabled);
    button.addEventListener("click", buttonModel.onClick);
    dom.actionButtons.appendChild(button);
  });

  dom.actionButtons.hidden = model.buttons.length === 0;
  dom.endTurnButton.hidden = state.match.over || !canPlayerStopEarly(state);
  dom.endTurnButton.disabled = !canPlayerStopEarly(state);
  dom.endTurnButton.textContent = "Stop Early";
}

function buildActionModel(state) {
  if (state.match.over) {
    return {
      title: "Match Over",
      text: state.match.reason,
      outcome: "Reset to play again.",
      phase: "Result",
      buttons: []
    };
  }

  if (state.phase === Engine.PHASES.PINFALL_DRAW) {
    const pinned = state.players[state.pinAttempt.defenderKey];
    const attacker = state.players[state.pinAttempt.attackerKey];

    return {
      title: "Pinfall Draw",
      text: `${pinned.name} is pinned by ${attacker.name}.`,
      outcome: `Kickout ends the pin. Three Fail cards end the match. ${state.pinAttempt.drawnCards.length} drawn so far.`,
      phase: `Count ${state.pinAttempt.drawnCards.length} / ${Engine.constants.PIN_DRAW_COUNT}`,
      buttons: [
        {
          label: "Draw Next Card",
          tone: "action-button--primary",
          onClick: () => {
            Engine.drawNextPinfallCard(app.state);
            refreshApp();
          }
        }
      ]
    };
  }

  if (state.phase === Engine.PHASES.TURN_END) {
    return {
      title: "Turn Ended",
      text: state.status || lastLogLine(state),
      outcome: "Advancing to the next turn.",
      phase: "Turn end",
      buttons: []
    };
  }

  if (state.phase === Engine.PHASES.RESOLVE_ATTACK && state.resolution?.defenderKey === "player") {
    return buildPlayerDefenceModel(state, false);
  }

  if (state.phase === Engine.PHASES.PIN_DEFENCE_DECISION && state.resolution?.defenderKey === "player") {
    return buildPlayerDefenceModel(state, true);
  }

  if (state.phase === Engine.PHASES.CHOOSE_NEXT_ACTION && state.turn.attackerKey === "player") {
    return {
      title: `Slot ${state.turn.nextSlot}: Your Move`,
      text: "Play an attack, taunt, or pin into the next sequential slot.",
      outcome: "You can stop early whenever you want.",
      phase: "Offensive sequence",
      buttons: []
    };
  }

  if (state.turn.attackerKey === "enemy") {
    const phase =
      state.phase === Engine.PHASES.RESOLVE_ATTACK || state.phase === Engine.PHASES.PIN_DEFENCE_DECISION
        ? "Enemy response"
        : "Enemy turn";

    return {
      title: "Stand By",
      text: `${state.players.enemy.name} is resolving the current turn.`,
      outcome: lastLogLine(state),
      phase,
      buttons: []
    };
  }

  return {
    title: "Resolving",
    text: state.status || "Working through the current state.",
    outcome: lastLogLine(state),
    phase: "State machine",
    buttons: []
  };
}

function buildPlayerDefenceModel(state, isPin) {
  if (state.resolution.awaitingCoinCall && state.resolution.defence) {
    return {
      title: "Call the Coin",
      text: `${state.resolution.defence.card.name} is ready. Pick Heads or Tails.`,
      outcome: buildCoinModeText(state.resolution.defence.coinMode),
      phase: isPin ? "Pin defence" : `Slot ${state.resolution.slot} defence`,
      buttons: Engine.COIN_SIDES.map((side) => {
        return {
          label: side,
          tone: side === "Heads" ? "action-button--dodge" : "action-button--reversal",
          onClick: () => {
            Engine.callDefenceCoin(app.state, side);
            refreshApp();
          }
        };
      })
    };
  }

  const attackCard = state.resolution.card;
  const defenceButtons = Engine.getDefenseOptions(state, "player").map((entry) => {
    return {
      label: entry.card.name,
      tone: entry.card.type === "dodge" ? "action-button--dodge" : "action-button--reversal",
      onClick: () => {
        Engine.prepareDefence(app.state, entry.handIndex);
        refreshApp();
      }
    };
  });

  return {
    title: isPin ? "Pin Incoming" : `Defend Slot ${state.resolution.slot}`,
    text: isPin
      ? `${attackCard.name} has been played. Decide whether to dodge, reverse, or take the pin.`
      : `${attackCard.name} is ${state.resolution.onSlot ? "on-slot" : "off-slot"} for ${attackCard.damage} damage.`,
    outcome: isPin
      ? "A successful reversal flips the same pin back."
      : state.resolution.onSlot
        ? "No defence or a failed defence lets the attack land."
        : "Off-slot attack: the defender has advantage on the coin flip.",
    phase: isPin ? "Pin defence" : "Attack defence",
    buttons: [
      ...defenceButtons,
      {
        label: isPin ? "No Defence" : "Take Hit",
        tone: "action-button--take",
        onClick: () => {
          Engine.chooseNoDefence(app.state);
          refreshApp();
        }
      }
    ]
  };
}

function buildCoinModeText(mode) {
  if (mode === "advantage") {
    return "Two flips. One matching side succeeds.";
  }

  if (mode === "disadvantage") {
    return "Two flips. Both sides must match.";
  }

  return "One flip decides it.";
}

function renderWrestlerPanel(state, wrestlerKey, panelDom) {
  const wrestler = state.players[wrestlerKey];
  const isAttacker = !state.match.over && state.turn.attackerKey === wrestlerKey;
  const pinSummary = Engine.getPinfallSummary(wrestler);
  const pinChance = calculatePinChance(pinSummary.fail, pinSummary.total);

  panelDom.name.textContent = wrestler.name;
  panelDom.role.textContent = isAttacker ? "Attacker" : "Defender";
  panelDom.role.classList.toggle("role-chip--attacker", isAttacker);
  panelDom.role.classList.toggle("role-chip--defender", !isAttacker);
  panelDom.stats.innerHTML = `
    <span class="stat-pill">DMG ${wrestler.damage}</span>
    <span class="stat-pill">HAND ${wrestler.hand.length}</span>
    <span class="stat-pill">DECK ${wrestler.maneuverDeck.length}</span>
  `;
  panelDom.pin.innerHTML = `
    <span class="stat-pill stat-pill--hot">FAIL ${pinSummary.fail}</span>
    <span class="stat-pill">KICKOUT ${pinSummary.kickout}</span>
    <span class="stat-pill">PIN ${formatPercent(pinChance)}</span>
  `;
  const statusLine = buildWrestlerStatusLine(state, wrestlerKey);
  panelDom.status.textContent = statusLine;
  panelDom.status.hidden = !statusLine;
  panelDom.card.dataset.state = pickPanelState(pinChance, wrestler.damage);
}

function buildWrestlerStatusLine(state, wrestlerKey) {
  const labels = [];

  if (!state.match.over) {
    labels.push(state.turn.attackerKey === wrestlerKey ? "Current attacker" : "Current defender");
  }

  if (state.pinAttempt?.defenderKey === wrestlerKey) {
    labels.push("Drawing from pinfall deck");
  }

  if (state.resolution?.defenderKey === wrestlerKey && state.phase !== Engine.PHASES.PINFALL_DRAW) {
    labels.push("Defence window open");
  }

  return labels.join(" / ");
}

function pickPanelState(pinChance, damage) {
  if (pinChance >= 0.35 || damage >= 20) {
    return "danger";
  }

  if (pinChance >= 0.18 || damage >= 10) {
    return "warning";
  }

  return "steady";
}

function calculatePinChance(failCount, totalCount) {
  if (failCount < 3 || totalCount < 3) {
    return 0;
  }

  let chance = 1;
  for (let index = 0; index < 3; index += 1) {
    chance *= (failCount - index) / (totalCount - index);
  }

  return chance;
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function renderHand(currentApp) {
  const state = currentApp.state;
  const player = state.players.player;
  const effectiveFilter = getEffectiveHandFilter(state, currentApp.ui.handFilter);
  const pinSummary = Engine.getPinfallSummary(player);

  dom.playerPinSummary.textContent = `Fail ${pinSummary.fail} / Kickout ${pinSummary.kickout}`;
  dom.drawPileCount.textContent = `Deck ${player.maneuverDeck.length} / Discard ${player.discardPile.length}`;
  dom.handCards.replaceChildren();

  if (player.hand.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Hand is empty.";
    dom.handCards.appendChild(empty);
    return;
  }

  const entries = player.hand.map((card, handIndex) => {
    return {
      card,
      handIndex,
      mode: getPlayerHandMode(state, card),
      category: getCardCategory(card)
    };
  });

  const filtered = entries.filter((entry) => {
    if (effectiveFilter === "all") {
      return true;
    }

    if (effectiveFilter === "usable") {
      return entry.mode.clickable;
    }

    if (effectiveFilter === "offense") {
      return Engine.OFFENSIVE_TYPES.has(entry.card.type);
    }

    if (effectiveFilter === "defense") {
      return Engine.DEFENSIVE_TYPES.has(entry.card.type);
    }

    if (effectiveFilter === "pin") {
      return entry.card.type === "pin";
    }

    return true;
  });

  const ordered = sortHandEntries(state, filtered);
  if (ordered.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = effectiveFilter === "usable" ? "No playable cards." : "Nothing here.";
    dom.handCards.appendChild(empty);
    return;
  }

  ordered.forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = [
      "hand-card",
      `hand-card--${entry.card.type}`,
      entry.mode.clickable ? "hand-card--live" : "hand-card--inactive",
      entry.mode.offSlot ? "hand-card--offslot" : "",
      entry.mode.validSlot ? "hand-card--valid" : ""
    ]
      .filter(Boolean)
      .join(" ");
    button.dataset.handIndex = String(entry.handIndex);
    button.setAttribute("aria-disabled", entry.mode.clickable ? "false" : "true");
    button.innerHTML = `
      <div class="hand-card__front">
        <span class="hand-card__type hand-card__type--${entry.card.type}">${capitalize(entry.card.type)}</span>
        <span class="hand-card__title">${entry.card.name}</span>
        <span class="hand-card__value">${formatCardPrimaryValue(entry.card)}</span>
        <span class="hand-card__label">${formatCardPrimaryLabel(entry.card)}</span>
      </div>
    `;
    button.addEventListener("click", () => openCardModal(currentApp, entry));
    dom.handCards.appendChild(button);
  });
}

function getEffectiveHandFilter(state, currentFilter) {
  if (state.resolution?.defenderKey === "player" && state.resolution.awaitingDefenceChoice) {
    return "defense";
  }

  if (state.turn.attackerKey !== "player") {
    return currentFilter === "defense" ? "all" : currentFilter;
  }

  return currentFilter;
}

function getPlayerHandMode(state, card) {
  if (state.match.over || state.phase === Engine.PHASES.PINFALL_DRAW) {
    return { clickable: false, reason: "Finish the current step." };
  }

  if (state.resolution?.defenderKey === "player" && state.resolution.awaitingDefenceChoice) {
    return Engine.DEFENSIVE_TYPES.has(card.type)
      ? { clickable: true, reason: "Use this to defend." }
      : { clickable: false, reason: "Not a defence card." };
  }

  if (state.resolution?.defenderKey === "player" && state.resolution.awaitingCoinCall) {
    return { clickable: false, reason: "Call the coin first." };
  }

  if (state.turn.attackerKey !== "player" || state.phase !== Engine.PHASES.CHOOSE_NEXT_ACTION) {
    return { clickable: false, reason: "Wait for your turn." };
  }

  if (!Engine.OFFENSIVE_TYPES.has(card.type)) {
    return { clickable: false, reason: "Hold this for defence." };
  }

  if (card.type === "pin") {
    return { clickable: true, reason: "Pins are slot-agnostic.", validSlot: true };
  }

  const onSlot = Engine.doesCardMatchSlot(card, state.turn.nextSlot);
  return onSlot
    ? { clickable: true, reason: "Correct slot.", validSlot: true }
    : { clickable: true, reason: "Off-slot but still legal.", offSlot: true };
}

function getCardCategory(card) {
  if (Engine.DEFENSIVE_TYPES.has(card.type)) {
    return "defense";
  }

  if (card.type === "pin") {
    return "pin";
  }

  return "offense";
}

function sortHandEntries(state, entries) {
  const order =
    state.resolution?.defenderKey === "player" && state.resolution.awaitingDefenceChoice
      ? ["dodge", "reversal", "attack", "taunt", "pin"]
      : ["attack", "taunt", "pin", "dodge", "reversal"];

  return [...entries].sort((left, right) => {
    if (left.mode.clickable !== right.mode.clickable) {
      return left.mode.clickable ? -1 : 1;
    }

    return order.indexOf(left.card.type) - order.indexOf(right.card.type);
  });
}

function renderRecentEvents(state) {
  dom.recentEventsList.replaceChildren();
  const recent = state.log.slice(-4);

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

function renderMatchLog(state) {
  dom.matchLogList.replaceChildren();

  state.log.forEach((entry) => {
    const item = document.createElement("li");
    item.textContent = entry;
    dom.matchLogList.appendChild(item);
  });
}

function openLogModal() {
  closeCardModal();
  dom.logModal.hidden = false;
  syncModalState();
}

function closeLogModal() {
  dom.logModal.hidden = true;
  syncModalState();
}

function openCardModal(currentApp, entry) {
  const { state } = currentApp;
  const card = entry.card;
  const cardReason = entry.mode.reason || "";

  closeLogModal();
  dom.cardModalType.textContent = capitalize(card.type);
  dom.cardModalTitle.textContent = card.name;
  dom.cardModalMeta.textContent = formatCardSlot(card);
  dom.cardModalValue.textContent = `${formatCardPrimaryLabel(card)} ${formatCardPrimaryValue(card)}`;
  dom.cardModalReason.textContent = cardReason;
  dom.cardModalReason.hidden = !cardReason;
  dom.cardModalEffect.textContent = describeCard(card);

  if (entry.mode.clickable) {
    dom.cardModalAction.hidden = false;
    dom.cardModalAction.disabled = false;
    dom.cardModalAction.textContent =
      state.resolution?.defenderKey === "player" && state.resolution.awaitingDefenceChoice
        ? `Use ${card.name}`
        : `Play ${card.name}`;
    dom.cardModalAction.onclick = () => {
      closeCardModal();

      if (state.resolution?.defenderKey === "player" && state.resolution.awaitingDefenceChoice) {
        Engine.prepareDefence(app.state, entry.handIndex);
        refreshApp();
        return;
      }

      Engine.playOffensiveCard(app.state, entry.handIndex, "player");
      refreshApp();
    };
  } else {
    dom.cardModalAction.hidden = true;
    dom.cardModalAction.disabled = true;
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
  dom.cardModalAction.onclick = null;
  syncModalState();
}

function syncModalState() {
  const anyModalOpen =
    (dom.logModal && !dom.logModal.hidden) ||
    (dom.cardModal && !dom.cardModal.hidden);
  document.body.classList.toggle("modal-open", Boolean(anyModalOpen));
}

function formatCardSlot(card) {
  if (card.validSlot === "any") {
    return card.type === "pin" ? "Pin / Any slot" : "Any slot";
  }

  if (card.validSlot === null || card.validSlot === undefined) {
    return "Defense";
  }

  return `Slot ${card.validSlot}`;
}

function formatCardPrimaryValue(card) {
  if (card.type === "attack") {
    return String(card.damage || 0);
  }

  if (card.type === "taunt") {
    return "SETUP";
  }

  if (card.type === "pin") {
    return "PIN";
  }

  return "DEF";
}

function formatCardPrimaryLabel(card) {
  if (card.type === "attack") {
    return "Damage";
  }

  if (card.type === "taunt") {
    return "Taunt";
  }

  if (card.type === "pin") {
    return "Pin";
  }

  return "Defense";
}

function describeCard(card) {
  const parts = [];

  if (card.type === "attack") {
    parts.push(`Deals ${card.damage} damage.`);
  }

  if (card.type === "taunt") {
    parts.push(`Undefendable taunt for slot ${card.validSlot}.`);
  }

  if (card.type === "pin") {
    parts.push("Slot-agnostic. Ends the offensive sequence immediately.");
  }

  if (card.onSlotEffect?.length) {
    parts.push(`On-slot: ${formatEffects(card.onSlotEffect)}.`);
  }

  if (card.offSlotEffect?.length || card.type === "taunt") {
    parts.push(`Off-slot: ${card.offSlotEffect?.length ? formatEffects(card.offSlotEffect) : "No effect"}.`);
  }

  if (card.onHitEffects?.length) {
    parts.push(`On hit: ${formatEffects(card.onHitEffects)}.`);
  }

  if (card.onPinEffects?.length) {
    parts.push(`On pin: ${formatEffects(card.onPinEffects)}.`);
  }

  if (card.afterUse === "exhaust") {
    parts.push("Exhausts after use.");
  }

  return parts.join(" ");
}

function formatEffects(effects) {
  return effects
    .map((effect) => {
      if (effect.type === "add_pinfall" || effect.type === "pinfall") {
        return `add ${effect.amount || 1} ${effect.card} to ${effect.target === "self" ? "your" : "their"} pinfall deck`;
      }

      if (effect.type === "modify_damage") {
        const amount = Number(effect.amount || 0);
        return `${amount >= 0 ? "+" : ""}${amount} damage`;
      }

      return effect.type;
    })
    .join(", ");
}

function canPlayerStopEarly(state) {
  return Boolean(
    state &&
      !state.match.over &&
      state.phase === Engine.PHASES.CHOOSE_NEXT_ACTION &&
      state.turn.attackerKey === "player"
  );
}

function resetHandFilter(filter) {
  app.ui.handFilter = filter;
  syncHandFilterChips(filter);
}

function syncHandFilterChips(filter) {
  dom.handFilters?.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.classList.toggle("is-active", chip.getAttribute("data-filter") === filter);
  });
}

function shortenCardName(name) {
  return name.length > 16 ? `${name.slice(0, 14)}…` : name;
}

function formatDefenceSummary(defence) {
  if (defence.choice === "none") {
    return "No defence";
  }

  if (defence.success === null) {
    return `${capitalize(defence.choice)} readied`;
  }

  return `${capitalize(defence.choice)} ${defence.success ? "success" : "failed"}`;
}

function lastLogLine(state) {
  return state.log[state.log.length - 1] || "";
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
