const Engine = window.UnderCardEngine;
const Shared = window.UnderCardDebugShared;

if (!Engine || !Shared) {
  throw new Error("UnderCard debug dependencies failed to load.");
}

const DATA_FILES = {
  cardPool: "../data/card-pool.json",
  deckRecipe: "../data/deck-recipe.json",
  wrestlers: "../data/wrestlers.json"
};

const gameData = {
  cardPool: [],
  cardLookup: {},
  deckRecipe: [],
  wrestlers: [],
  cardLibrary: [],
  cardOptionCache: new Map()
};

const app = {
  state: null,
  settings: Shared.createDefaultSettings(),
  notice: "",
  sync: {
    sourceId: Shared.createSourceId("debug"),
    lastUpdatedAt: 0,
    lastExternalSource: ""
  },
  autoRunTimer: null
};

const dom = {
  syncPill: document.getElementById("sync-pill"),
  syncSummary: document.getElementById("sync-summary"),
  startMatchButton: document.getElementById("start-match-button"),
  applyRulesButton: document.getElementById("apply-rules-button"),
  pullSessionButton: document.getElementById("pull-session-button"),
  copyStateButton: document.getElementById("copy-state-button"),
  continueTurnButton: document.getElementById("continue-turn-button"),
  runEnemyButton: document.getElementById("run-enemy-button"),
  drawPinButton: document.getElementById("draw-pin-button"),
  noDefenceButton: document.getElementById("no-defence-button"),
  runToPlayerButton: document.getElementById("run-to-player-button"),
  stopAutoplayButton: document.getElementById("stop-autoplay-button"),
  playerTemplateSelect: document.getElementById("player-template-select"),
  enemyTemplateSelect: document.getElementById("enemy-template-select"),
  initiativeSelect: document.getElementById("initiative-select"),
  aiStepDelayInput: document.getElementById("ai-step-delay-input"),
  shuffleDeckCheckbox: document.getElementById("shuffle-deck-checkbox"),
  rarityLimitsTable: document.getElementById("rarity-limits-table"),
  ruleFeedback: document.getElementById("rule-feedback"),
  ruleInputs: {
    handSize: document.getElementById("rule-hand-size"),
    maxSequenceSlots: document.getElementById("rule-max-sequence-slots"),
    damagePerFail: document.getElementById("rule-damage-per-fail"),
    pinDrawCount: document.getElementById("rule-pin-draw-count"),
    startingPinFails: document.getElementById("rule-starting-pin-fails"),
    startingPinKickouts: document.getElementById("rule-starting-pin-kickouts")
  },
  matchSummaryGrid: document.getElementById("match-summary-grid"),
  sequenceTrack: document.getElementById("sequence-track"),
  aiInsight: document.getElementById("ai-insight"),
  recentLogList: document.getElementById("recent-log-list"),
  rawStateOutput: document.getElementById("raw-state-output"),
  playerEditors: {
    player: document.getElementById("player-editor-player"),
    enemy: document.getElementById("player-editor-enemy")
  }
};

boot();

async function boot() {
  bindEvents();

  try {
    await loadGameData();
    validateGameData();
    buildCardLibrary();
    ensureDefaultRosterSelection();
    populateRosterControls();
    renderRarityLimits();

    const session = Shared.readSession();
    if (session && applySharedSession(session)) {
      return;
    }

    syncControlsFromSettings();
    startNewMatch();
  } catch (error) {
    renderFatalError(error);
  }
}

function bindEvents() {
  dom.startMatchButton?.addEventListener("click", startNewMatch);
  dom.applyRulesButton?.addEventListener("click", applyLiveRules);
  dom.pullSessionButton?.addEventListener("click", pullLatestSession);
  dom.copyStateButton?.addEventListener("click", copyStateSnapshot);
  dom.continueTurnButton?.addEventListener("click", continueTurn);
  dom.runEnemyButton?.addEventListener("click", runEnemyStep);
  dom.drawPinButton?.addEventListener("click", drawPinfallCard);
  dom.noDefenceButton?.addEventListener("click", chooseNoDefence);
  dom.runToPlayerButton?.addEventListener("click", startAutoRunToPlayerChoice);
  dom.stopAutoplayButton?.addEventListener("click", stopAutoRun);
  window.addEventListener("storage", handleSessionStorage);

  bindPlayerEditor(dom.playerEditors.player, "player");
  bindPlayerEditor(dom.playerEditors.enemy, "enemy");
}

async function loadGameData() {
  const loaded = await Promise.all(
    Object.entries(DATA_FILES).map(async ([key, path]) => {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`Could not load ${path}.`);
      }

      const data = await response.json();
      return [key, data];
    })
  );

  loaded.forEach(([key, data]) => {
    gameData[key] = data;
  });

  gameData.cardLookup = Object.fromEntries(gameData.cardPool.map((card) => [card.id, card]));
}

function validateGameData() {
  if (!Array.isArray(gameData.cardPool) || gameData.cardPool.length === 0) {
    throw new Error("Card pool is empty.");
  }

  if (!Array.isArray(gameData.deckRecipe) || gameData.deckRecipe.length === 0) {
    throw new Error("Deck recipe is empty.");
  }

  if (!Array.isArray(gameData.wrestlers) || gameData.wrestlers.length === 0) {
    throw new Error("Wrestler data is empty.");
  }

  const baseDeckSize = gameData.deckRecipe.reduce((sum, entry) => sum + Number(entry.count || 0), 0);
  if (baseDeckSize !== 50) {
    throw new Error(`Expected a 50-card base recipe. Found ${baseDeckSize}.`);
  }

  gameData.wrestlers.forEach((wrestler) => {
    Engine.buildDeckForWrestler(wrestler, gameData.cardLookup, gameData.deckRecipe);
  });
}

function buildCardLibrary() {
  const cards = gameData.cardPool.map((card) => {
    return {
      id: card.id,
      wrestlerName: "",
      isSignature: false,
      card: Engine.normalizeCard(card)
    };
  });

  gameData.wrestlers.forEach((wrestler) => {
    if (!wrestler.signature) {
      return;
    }

    cards.push({
      id: wrestler.signature.id,
      wrestlerName: wrestler.name,
      isSignature: true,
      card: Engine.normalizeCard(wrestler.signature)
    });
  });

  gameData.cardLibrary = cards.sort((left, right) => {
    const leftLabel = buildCardLibraryLabel(left);
    const rightLabel = buildCardLibraryLabel(right);
    return leftLabel.localeCompare(rightLabel);
  });
}

function buildCardLibraryLabel(entry) {
  const card = entry.card;
  const slotLabel = card.validSlot === "any"
    ? "Any"
    : Array.isArray(card.slotOptions) && card.slotOptions.length > 1
      ? `S${card.slotOptions.join("/")}`
      : card.validSlot === null
        ? "Def"
        : `S${card.validSlot}`;
  const statLabel = card.type === "attack" ? `${card.damage} dmg` : card.type === "pin" ? "Pin" : "Utility";
  const ownerLabel = entry.isSignature ? ` / ${entry.wrestlerName}` : "";
  return `${capitalize(card.type)} / ${card.name} / ${slotLabel} / ${statLabel}${ownerLabel}`;
}

function ensureDefaultRosterSelection() {
  if (!app.settings.playerTemplateName) {
    const roster = gameData.wrestlers;
    app.settings.playerTemplateName =
      (roster.length > 1 ? roster[1].name : roster[0]?.name) || "";
  }
}

function populateRosterControls() {
  const rosterOptions = gameData.wrestlers
    .map((wrestler) => `<option value="${escapeAttribute(wrestler.name)}">${escapeHtml(wrestler.name)}</option>`)
    .join("");

  dom.playerTemplateSelect.innerHTML = rosterOptions;
  dom.enemyTemplateSelect.innerHTML = `<option value="">Random Opponent</option>${rosterOptions}`;
  syncControlsFromSettings();
}

function renderRarityLimits() {
  const rows = Object.entries(app.settings.rarityLimits)
    .map(([rarity, count]) => {
      return `<div class="mini-table__row"><strong>${escapeHtml(rarity)}</strong><span>${count}</span></div>`;
    })
    .join("");

  dom.rarityLimitsTable.innerHTML = rows;
}

function startNewMatch() {
  pullSettingsFromControls();
  stopAutoRun();
  app.state = createMatchFromSettings(app.settings);
  app.notice = "Started a fresh match with the current setup.";
  persistSession();
  render();
}

function createMatchFromSettings(settings) {
  const matchup = pickMatchupFromSettings(settings);
  return Engine.createMatch({
    rules: settings.rules,
    initiativeWinner: settings.initiativeWinner || undefined,
    player: {
      name: matchup.player.name,
      maneuverDeck: Engine.buildDeckForWrestler(matchup.player, gameData.cardLookup, gameData.deckRecipe),
      shuffleManeuverDeck: settings.shuffleManeuverDeck
    },
    enemy: {
      name: matchup.enemy.name,
      maneuverDeck: Engine.buildDeckForWrestler(matchup.enemy, gameData.cardLookup, gameData.deckRecipe),
      shuffleManeuverDeck: settings.shuffleManeuverDeck
    }
  });
}

function pickMatchupFromSettings(settings) {
  const roster = gameData.wrestlers;
  const trimmed = typeof settings.playerTemplateName === "string" ? settings.playerTemplateName.trim() : "";
  const named = trimmed ? roster.find((wrestler) => wrestler.name === trimmed) : null;
  const playerTemplate =
    named || roster[Math.floor(Math.random() * roster.length)] || roster[0];
  const enemyTemplate = pickEnemyTemplate(playerTemplate, settings.enemyTemplateName);

  return {
    player: cloneWrestler(playerTemplate),
    enemy: cloneWrestler(enemyTemplate)
  };
}

function pickEnemyTemplate(playerTemplate, enemyTemplateName) {
  if (enemyTemplateName) {
    return gameData.wrestlers.find((wrestler) => wrestler.name === enemyTemplateName) || playerTemplate;
  }

  const pool = gameData.wrestlers.filter((wrestler) => wrestler.name !== playerTemplate.name);
  return pool[Math.floor(Math.random() * pool.length)] || playerTemplate;
}

function cloneWrestler(wrestler) {
  return {
    name: wrestler.name,
    category: wrestler.category
  };
}

function applyLiveRules() {
  pullSettingsFromControls();

  if (!app.state) {
    startNewMatch();
    return;
  }

  if (app.state.match.over) {
    app.state.rules = Engine.buildRules(app.settings.rules);
    app.notice = "Saved the new rule variables. Start a fresh match to use them.";
    persistSession();
    render();
    return;
  }

  const result = Engine.updateRules(app.state, app.settings.rules);
  app.notice =
    result.warnings.length > 0
      ? result.warnings.join(" ")
      : "Applied the current rule variables to the live match.";
  persistSession();
  render();
}

function pullLatestSession() {
  const session = Shared.readSession();
  if (!session || !session.state) {
    app.notice = "No shared live session is available yet.";
    render();
    return;
  }

  applySharedSession(session, { external: true });
}

function applySharedSession(session, options = {}) {
  if (!session) {
    return false;
  }

  stopAutoRun();
  app.settings = Shared.mergeSettings(app.settings, session.settings);
  app.sync.lastUpdatedAt = Number(session.updatedAt || 0);
  app.sync.lastExternalSource = session.sourceId || "";

  syncControlsFromSettings();
  renderRarityLimits();

  if (session.state) {
    app.state = Engine.hydrateMatchState(session.state);
  }

  app.notice = options.external
    ? "Pulled the latest session from another tab."
    : "Restored the shared match snapshot.";
  render();
  return Boolean(session.state);
}

function persistSession() {
  if (!app.state) {
    return;
  }

  const session = Shared.buildSession({
    sourceId: app.sync.sourceId,
    settings: app.settings,
    state: Engine.serializeMatchState(app.state)
  });

  Shared.writeSession(session);
  app.sync.lastUpdatedAt = session.updatedAt;
  app.sync.lastExternalSource = app.sync.sourceId;
}

function handleSessionStorage(event) {
  if (event.key !== Shared.SESSION_STORAGE_KEY || !event.newValue) {
    return;
  }

  const session = Shared.readSession();
  if (!session || session.sourceId === app.sync.sourceId || session.updatedAt <= app.sync.lastUpdatedAt) {
    return;
  }

  applySharedSession(session, { external: true });
}

function syncControlsFromSettings() {
  const settings = app.settings;
  dom.playerTemplateSelect.value =
    (typeof settings.playerTemplateName === "string" && settings.playerTemplateName.trim()) ||
    gameData.wrestlers[1]?.name ||
    gameData.wrestlers[0]?.name ||
    "";
  dom.enemyTemplateSelect.value = settings.enemyTemplateName || "";
  dom.initiativeSelect.value = settings.initiativeWinner || "";
  dom.aiStepDelayInput.value = String(settings.aiStepDelay);
  dom.shuffleDeckCheckbox.checked = Boolean(settings.shuffleManeuverDeck);

  Object.entries(dom.ruleInputs).forEach(([key, node]) => {
    node.value = String(settings.rules[key]);
  });
}

function pullSettingsFromControls() {
  app.settings = Shared.mergeSettings(app.settings, {
    playerTemplateName: dom.playerTemplateSelect.value,
    enemyTemplateName: dom.enemyTemplateSelect.value,
    initiativeWinner: dom.initiativeSelect.value,
    shuffleManeuverDeck: dom.shuffleDeckCheckbox.checked,
    aiStepDelay: Number(dom.aiStepDelayInput.value || 0),
    rules: {
      handSize: Number(dom.ruleInputs.handSize.value || app.settings.rules.handSize),
      maxSequenceSlots: Number(dom.ruleInputs.maxSequenceSlots.value || app.settings.rules.maxSequenceSlots),
      damagePerFail: Number(dom.ruleInputs.damagePerFail.value || app.settings.rules.damagePerFail),
      pinDrawCount: Number(dom.ruleInputs.pinDrawCount.value || app.settings.rules.pinDrawCount),
      startingPinFails: Number(dom.ruleInputs.startingPinFails.value || app.settings.rules.startingPinFails),
      startingPinKickouts: Number(dom.ruleInputs.startingPinKickouts.value || app.settings.rules.startingPinKickouts)
    }
  });
}

function render() {
  renderSyncStatus();
  renderRuleFeedback();
  renderMatchSummary();
  renderActionButtons();
  renderSequenceTrack();
  renderAiInsight();
  renderRecentLogs();
  renderRawState();
  renderPlayerEditor("player");
  renderPlayerEditor("enemy");
}

function renderSyncStatus() {
  const hasState = Boolean(app.state);
  const stateLabel = app.autoRunTimer
    ? "Auto"
    : !hasState
      ? "Idle"
      : app.sync.lastExternalSource && app.sync.lastExternalSource !== app.sync.sourceId
        ? "Live"
        : "Synced";

  dom.syncPill.textContent = stateLabel;
  dom.syncPill.dataset.state = app.autoRunTimer
    ? "warning"
    : !hasState
      ? "stopped"
      : app.sync.lastExternalSource && app.sync.lastExternalSource !== app.sync.sourceId
        ? "external"
        : "synced";

  const stamp = app.sync.lastUpdatedAt
    ? `Last session write ${new Date(app.sync.lastUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}.`
    : "No shared session saved yet.";
  const source =
    app.sync.lastExternalSource && app.sync.lastExternalSource !== app.sync.sourceId
      ? ` Most recent source: ${app.sync.lastExternalSource}.`
      : "";
  const auto = app.autoRunTimer ? ` Auto-run delay ${app.settings.aiStepDelay}ms.` : "";
  dom.syncSummary.textContent = `${stamp}${source}${auto}`;
}

function renderRuleFeedback() {
  dom.ruleFeedback.textContent =
    app.notice ||
    "Rule changes apply to the live match where it is safe and always carry into the next fresh match.";
}

function renderMatchSummary() {
  if (!app.state) {
    dom.matchSummaryGrid.innerHTML = `<div class="summary-grid__row"><strong>Status</strong><span>Waiting for a match.</span></div>`;
    return;
  }

  const attacker = app.state.match.over ? null : app.state.players[app.state.turn.attackerKey];
  const defender = app.state.match.over ? null : app.state.players[app.state.turn.defenderKey];
  const slotCap = app.state.turn?.slots?.length || app.state.rules.maxSequenceSlots;
  const summaryRows = [
    ["Phase", app.state.phase],
    ["Turn", String(app.state.turn?.number || "-")],
    ["Attacker", attacker ? attacker.name : "-"],
    ["Defender", defender ? defender.name : "-"],
    ["Next Slot", app.state.match.over ? "-" : `${Math.min(app.state.turn.nextSlot, slotCap)} / ${slotCap}`],
    ["Status", app.state.status || "-"],
    ["Outcome", app.state.outcome || "-"],
    ["Result", app.state.match.over ? app.state.match.reason : "Match in progress"]
  ];

  dom.matchSummaryGrid.innerHTML = summaryRows
    .map(([label, value]) => {
      return `<div class="summary-grid__row"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`;
    })
    .join("");
}

function renderActionButtons() {
  const canContinue = Boolean(app.state) && app.state.phase === Engine.PHASES.TURN_END && !app.state.match.over;
  const canEnemyStep = canRunEnemyStep();
  const canDrawPin = Boolean(app.state) && app.state.phase === Engine.PHASES.PINFALL_DRAW && !app.state.match.over;
  const canNoDefence =
    Boolean(app.state?.resolution?.awaitingDefenceChoice) && !app.state.match.over;
  const canAuto = Boolean(app.state) && !app.state.match.over && !app.autoRunTimer;

  dom.continueTurnButton.disabled = !canContinue;
  dom.runEnemyButton.disabled = !canEnemyStep;
  dom.drawPinButton.disabled = !canDrawPin;
  dom.noDefenceButton.disabled = !canNoDefence;
  dom.runToPlayerButton.disabled = !canAuto;
  dom.stopAutoplayButton.disabled = !app.autoRunTimer;

  if (!app.state) {
    dom.runEnemyButton.textContent = "Run Enemy Step";
    return;
  }

  dom.runEnemyButton.textContent =
    app.state.phase === Engine.PHASES.CHOOSE_NEXT_ACTION && app.state.turn.attackerKey === "enemy"
      ? "Enemy Offence"
      : "Enemy Defence";
}

function renderSequenceTrack() {
  if (!app.state?.turn) {
    dom.sequenceTrack.innerHTML = `<p class="empty-copy">Start a match to inspect the sequence track.</p>`;
    return;
  }

  const activeSlot = getActiveSlot(app.state);
  dom.sequenceTrack.innerHTML = app.state.turn.slots
    .map((slot) => {
      const card = slot.card;
      const classes = [
        "sequence-slot",
        activeSlot === slot.slot ? "sequence-slot--active" : "",
        card && slot.result !== "Resolving" ? "sequence-slot--resolved" : "",
        !card ? "sequence-slot--empty" : ""
      ]
        .filter(Boolean)
        .join(" ");

      const title = card ? card.name : activeSlot === slot.slot ? "Current slot" : "Waiting";
      const owner = card ? app.state.players[slot.ownerKey]?.name || slot.ownerKey : "";
      const defence = slot.defence
        ? `Defence: ${slot.defence.choice}${slot.defence.cardName ? ` / ${slot.defence.cardName}` : ""}`
        : "Defence: none";
      const meta = card
        ? `${capitalize(card.type)} / ${
            card.validSlot === "any"
              ? "Any slot"
              : Array.isArray(card.slotOptions) && card.slotOptions.length > 1
                ? `Slots ${card.slotOptions.join("/")}`
                : card.validSlot === null
                  ? "Defence"
                  : `Slot ${card.validSlot}`
          }`
        : "Open";

      return `
        <article class="${classes}">
          <div class="chip-row">
            <span class="slot-chip">Slot ${slot.slot}</span>
            <span class="card-type card-type--${card?.type || "attack"}">${escapeHtml(meta)}</span>
          </div>
          <h3 class="sequence-slot__title">${escapeHtml(title)}</h3>
          <p class="sequence-slot__copy">${escapeHtml(owner || "No card committed yet.")}</p>
          <p class="sequence-slot__copy">${escapeHtml(slot.result || "Open")}</p>
          <p class="sequence-slot__copy">${escapeHtml(defence)}</p>
        </article>
      `;
    })
    .join("");
}

function renderAiInsight() {
  if (!app.state) {
    dom.aiInsight.innerHTML = `<p class="empty-copy">The AI forecast appears once a match is active.</p>`;
    return;
  }

  if (app.state.phase === Engine.PHASES.CHOOSE_NEXT_ACTION && app.state.turn.attackerKey === "enemy") {
    const insight = Engine.inspectAiOffence(app.state, "enemy");
    renderAiOffenceInsight(insight);
    return;
  }

  if (app.state.resolution?.awaitingDefenceChoice && app.state.resolution.defenderKey === "enemy") {
    const insight = Engine.inspectAiDefence(app.state);
    renderAiDefenceInsight(insight);
    return;
  }

  dom.aiInsight.innerHTML = `
    <div class="insight-callout">
      <p><strong>Stand by.</strong> The enemy forecast updates when the AI is about to play offence or choose a defence card.</p>
    </div>
  `;
}

function renderAiOffenceInsight(insight) {
  if (insight.type !== "play") {
    dom.aiInsight.innerHTML = `<p class="empty-copy">${escapeHtml(insight.reason || "No offensive move available.")}</p>`;
    return;
  }

  const optionsMarkup = insight.options
    .map((option, index) => {
      const isTop = index === 0;
      const breakdown = option.breakdown
        .map((entry) => `${entry.label}: ${entry.value}`)
        .join(" / ");
      return `
        <div class="probability-row">
          <div>
            <p><strong>${escapeHtml(option.card.name)}</strong></p>
            <p class="muted-copy">${escapeHtml(option.explanation)}</p>
            <p class="muted-copy">${escapeHtml(breakdown || "No extra weight.")}</p>
          </div>
          <span class="probability-pill ${isTop ? "probability-pill--top" : ""}">${option.scoreRange[0]}-${option.scoreRange[1]}</span>
        </div>
      `;
    })
    .join("");

  dom.aiInsight.innerHTML = `
    <div class="insight-stack">
      <div class="insight-callout">
        <p><strong>Likely move:</strong> ${escapeHtml(insight.choice.card.name)}</p>
        <p>${escapeHtml(insight.choice.explanation)}</p>
        <p class="muted-copy">Confidence: ${escapeHtml(insight.certainty)}. Small random noise can still swing very close scores.</p>
      </div>
      ${optionsMarkup}
    </div>
  `;
}

function renderAiDefenceInsight(insight) {
  if (insight.type !== "decision") {
    dom.aiInsight.innerHTML = `<p class="empty-copy">${escapeHtml(insight.reason || "No defence forecast available.")}</p>`;
    return;
  }

  const choiceMarkup = insight.choices
    .map((choice, index) => {
      const label =
        choice.type === "none"
          ? "No defence"
          : `${capitalize(choice.type)}${choice.card ? ` / ${choice.card.name}` : ""}`;
      return `
        <div class="probability-row">
          <div>
            <p><strong>${escapeHtml(label)}</strong></p>
            <p class="muted-copy">${choice.type === "none" ? "The AI keeps the card." : "First matching card in hand is selected."}</p>
          </div>
          <span class="probability-pill ${index === 0 ? "probability-pill--top" : ""}">${formatPercent(choice.probability)}</span>
        </div>
      `;
    })
    .join("");

  const notes = insight.rationale.map((note) => `<li>${escapeHtml(note)}</li>`).join("");

  dom.aiInsight.innerHTML = `
    <div class="insight-stack">
      <div class="insight-callout">
        <p><strong>Defence odds:</strong> ${formatPercent(insight.defendChance)} to spend a card.</p>
        <p><strong>Roll-off:</strong> ${formatPercent(insight.defenceWinRate)} win rate on ${escapeHtml(insight.coinMode)} mode.</p>
        <p class="muted-copy">Threat score ${insight.threat}.</p>
      </div>
      ${choiceMarkup}
      <ul class="reason-list">${notes}</ul>
    </div>
  `;
}

function renderRecentLogs() {
  if (!app.state) {
    dom.recentLogList.innerHTML = `<li class="empty-copy">No match log yet.</li>`;
    return;
  }

  const recent = app.state.log.filter((entry) => !entry.startsWith("LOG_STATE ")).slice(-10).reverse();
  dom.recentLogList.innerHTML = recent.length
    ? recent.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")
    : `<li class="empty-copy">Nothing has happened yet.</li>`;
}

function renderRawState() {
  const snapshot = {
    settings: app.settings,
    state: app.state ? Engine.serializeMatchState(app.state) : null
  };

  dom.rawStateOutput.textContent = JSON.stringify(snapshot, null, 2);
}

function renderPlayerEditor(playerKey) {
  const container = dom.playerEditors[playerKey];
  const state = app.state;

  if (!state) {
    container.innerHTML = `
      <div class="player-editor__header">
        <div>
          <p class="debug-card__eyebrow">${capitalize(playerKey)}</p>
          <h2>Waiting</h2>
        </div>
      </div>
      <p class="empty-copy">Start a match to inspect this wrestler.</p>
    `;
    return;
  }

  const player = state.players[playerKey];
  const pinSummary = Engine.getPinfallSummary(player);
  const pinChance = calculatePinChance(pinSummary.fail, pinSummary.total, state.rules.pinDrawCount);
  const active = !state.match.over && state.turn.attackerKey === playerKey;
  const failInputId = `${playerKey}-fail-input`;
  const kickoutInputId = `${playerKey}-kickout-input`;
  const damageInputId = `${playerKey}-damage-input`;

  container.innerHTML = `
    <div class="player-editor__header">
      <div>
        <p class="debug-card__eyebrow">${capitalize(playerKey)}</p>
        <h2 class="player-editor__name">${escapeHtml(player.name)}</h2>
      </div>
      <span class="status-pill" data-state="${active ? "warning" : "synced"}">${active ? "Acting" : "Watching"}</span>
    </div>
    <div class="player-editor__stats">
      <span class="metric-chip">DMG ${player.damage}</span>
      <span class="metric-chip">HAND ${player.hand.length}</span>
      <span class="metric-chip">DECK ${player.maneuverDeck.length}</span>
      <span class="metric-chip metric-chip--alert">PIN ${formatPercent(pinChance)}</span>
    </div>
    <div class="chip-row">
      <label>
        <span>Damage</span>
        <input id="${damageInputId}" data-field="damage" type="number" min="0" step="1" value="${player.damage}">
      </label>
      <label>
        <span>Fails</span>
        <input id="${failInputId}" data-field="fail-count" type="number" min="0" step="1" value="${pinSummary.fail}">
      </label>
      <label>
        <span>Kickouts</span>
        <input id="${kickoutInputId}" data-field="kickout-count" type="number" min="0" step="1" value="${pinSummary.kickout}">
      </label>
    </div>
    <div class="player-editor__controls">
      <button class="debug-button" data-action="damage-delta" data-amount="1" type="button">+1 DMG</button>
      <button class="debug-button" data-action="damage-delta" data-amount="5" type="button">+5 DMG</button>
      <button class="debug-button" data-action="damage-delta" data-amount="-5" type="button">-5 DMG</button>
      <button class="debug-button" data-action="draw-top-card" type="button">Draw Top</button>
    </div>
    <div class="hand-add-row">
      <select data-role="add-card-select">${buildCardOptions()}</select>
      <button class="debug-button" data-action="add-card" type="button">Add To Hand</button>
      <button class="debug-button" data-action="refill-hand" type="button">Refill To Hand Size</button>
    </div>
    <ul class="hand-list">${buildHandMarkup(playerKey, player)}</ul>
    <div class="pile-grid">
      ${buildPileMarkup(player, "maneuverDeck", "Deck")}
      ${buildPileMarkup(player, "discardPile", "Discard")}
      ${buildPileMarkup(player, "exhaustPile", "Exhaust")}
    </div>
  `;
}

function buildHandMarkup(playerKey, player) {
  if (player.hand.length === 0) {
    return `<li class="empty-copy">Hand is empty.</li>`;
  }

  return player.hand
    .map((card, handIndex) => {
      const playModel = getPlayableActionForCard(playerKey, handIndex, card);
      const slotLabel = card.validSlot === "any"
        ? "Any slot"
        : Array.isArray(card.slotOptions) && card.slotOptions.length > 1
          ? `Slots ${card.slotOptions.join("/")}`
          : card.validSlot === null
            ? "Defence"
            : `Slot ${card.validSlot}`;
      const valueLabel =
        card.type === "attack" ? `${card.damage} dmg` : card.type === "pin" ? "Pin" : card.afterUse === "exhaust" ? "Exhaust" : "Utility";

      return `
        <li class="hand-row ${playModel.enabled ? "hand-row--playable" : ""}">
          <div class="hand-row__top">
            <strong>${escapeHtml(card.name)}</strong>
            <span class="card-type card-type--${card.type}">${escapeHtml(capitalize(card.type))}</span>
            <span class="slot-chip">${escapeHtml(slotLabel)}</span>
          </div>
          <div class="hand-row__meta">
            <span class="pile-chip pile-chip--${card.type}">${escapeHtml(valueLabel)}</span>
            <span class="pile-chip">${escapeHtml(card.afterUse === "exhaust" ? "Exhaust" : "Discard")}</span>
            ${playModel.reason ? `<span class="pile-chip">${escapeHtml(playModel.reason)}</span>` : ""}
          </div>
          <div class="hand-row__controls">
            <select data-action="replace-card" data-hand-index="${handIndex}">
              ${buildCardOptions(card.id)}
            </select>
            <button class="debug-button ${playModel.enabled ? "debug-button--primary" : ""}" data-action="play-card" data-hand-index="${handIndex}" type="button" ${playModel.enabled ? "" : "disabled"}>${escapeHtml(playModel.label)}</button>
            <button class="debug-button" data-action="remove-card" data-hand-index="${handIndex}" type="button">Remove</button>
          </div>
        </li>
      `;
    })
    .join("");
}

function buildPileMarkup(player, key, label) {
  const pile = player[key] || [];
  const topEntries = pile.slice(0, 8).map((card) => `<li>${escapeHtml(card.name)}</li>`).join("");
  return `
    <div class="pile-row">
      <strong>${escapeHtml(label)}</strong>
      <span>${pile.length}</span>
      <details>
        <summary>Show first 8 cards</summary>
        <ul class="pile-list">${topEntries || `<li class="empty-copy">Empty.</li>`}</ul>
      </details>
    </div>
  `;
}

function bindPlayerEditor(container, playerKey) {
  container.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || !app.state) {
      return;
    }

    const action = button.dataset.action;
    const handIndex = Number(button.dataset.handIndex || -1);

    if (action === "damage-delta") {
      setPlayerDamage(playerKey, app.state.players[playerKey].damage + Number(button.dataset.amount || 0));
      return;
    }

    if (action === "draw-top-card") {
      drawTopCardToHand(playerKey);
      return;
    }

    if (action === "add-card") {
      const select = container.querySelector('[data-role="add-card-select"]');
      addCardToHand(playerKey, select?.value);
      return;
    }

    if (action === "refill-hand") {
      refillHandToLimit(playerKey);
      return;
    }

    if (action === "play-card") {
      playCardFromHand(playerKey, handIndex);
      return;
    }

    if (action === "remove-card") {
      removeCardFromHand(playerKey, handIndex);
    }
  });

  container.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement) || !app.state) {
      return;
    }

    if (target.dataset.field === "damage") {
      setPlayerDamage(playerKey, Number(target.value || 0));
      return;
    }

    if (target.dataset.field === "fail-count" || target.dataset.field === "kickout-count") {
      const failValue = Number(container.querySelector('[data-field="fail-count"]')?.value || 0);
      const kickoutValue = Number(container.querySelector('[data-field="kickout-count"]')?.value || 0);
      setPinfallDeckCounts(playerKey, failValue, kickoutValue);
      return;
    }

    if (target.dataset.action === "replace-card") {
      replaceCardInHand(playerKey, Number(target.dataset.handIndex || -1), target.value);
    }
  });
}

function getPlayableActionForCard(playerKey, handIndex, card) {
  if (!app.state || app.state.match.over) {
    return { enabled: false, label: "Locked", reason: "Match over" };
  }

  if (app.state.phase === Engine.PHASES.CHOOSE_NEXT_ACTION && app.state.turn.attackerKey === playerKey) {
    if (Engine.OFFENSIVE_TYPES.has(card.type)) {
      return { enabled: true, label: "Play", reason: `Slot ${app.state.turn.nextSlot}` };
    }

    return { enabled: false, label: "Hold", reason: "Defence card" };
  }

  if (app.state.resolution?.awaitingDefenceChoice && app.state.resolution.defenderKey === playerKey) {
    if (Engine.DEFENSIVE_TYPES.has(card.type)) {
      return { enabled: true, label: "Defend", reason: "Legal defence" };
    }

    return { enabled: false, label: "Locked", reason: "Not defence" };
  }

  return { enabled: false, label: "Waiting", reason: playerKey === app.state.turn.attackerKey ? "Resolving" : "Not active" };
}

function setPlayerDamage(playerKey, value) {
  if (!app.state) {
    return;
  }

  stopAutoRun();
  const player = app.state.players[playerKey];
  const nextDamage = Math.max(0, Math.floor(Number(value || 0)));
  const previousThresholds = Number(player.failThresholdsReached || 0);
  const nextThresholds = Math.floor(nextDamage / app.state.rules.damagePerFail);
  player.damage = nextDamage;

  if (nextThresholds > previousThresholds) {
    addPinfallCards(player, nextThresholds - previousThresholds, "Fail");
  }

  player.failThresholdsReached = nextThresholds;
  app.notice = `${player.name}'s damage is now ${player.damage}.`;
  persistSession();
  render();
}

function setPinfallDeckCounts(playerKey, failCount, kickoutCount) {
  if (!app.state) {
    return;
  }

  stopAutoRun();
  const player = app.state.players[playerKey];
  player.pinfallDeck = buildPinfallDeck(Math.max(0, failCount), Math.max(0, kickoutCount));
  shuffleInPlace(player.pinfallDeck);
  app.notice = `${player.name}'s pinfall deck was rebuilt and shuffled.`;
  persistSession();
  render();
}

function buildPinfallDeck(failCount, kickoutCount) {
  const deck = [];

  for (let index = 0; index < failCount; index += 1) {
    deck.push("Fail");
  }

  for (let index = 0; index < kickoutCount; index += 1) {
    deck.push("Kickout");
  }

  return deck;
}

function addPinfallCards(player, amount, cardType) {
  for (let index = 0; index < amount; index += 1) {
    player.pinfallDeck.push(cardType);
  }

  shuffleInPlace(player.pinfallDeck);
}

function drawTopCardToHand(playerKey) {
  if (!app.state) {
    return;
  }

  stopAutoRun();
  const player = app.state.players[playerKey];

  if (player.maneuverDeck.length === 0 && player.discardPile.length > 0) {
    player.maneuverDeck = player.discardPile.splice(0);
    shuffleInPlace(player.maneuverDeck);
  }

  const card = player.maneuverDeck.shift();
  if (!card) {
    app.notice = `${player.name} has no card to draw.`;
    render();
    return;
  }

  player.hand.push(card);
  app.notice = `${player.name} drew ${card.name}.`;
  persistSession();
  render();
}

function refillHandToLimit(playerKey) {
  if (!app.state) {
    return;
  }

  stopAutoRun();
  const player = app.state.players[playerKey];

  while (player.hand.length < app.state.rules.handSize) {
    if (player.maneuverDeck.length === 0 && player.discardPile.length > 0) {
      player.maneuverDeck = player.discardPile.splice(0);
      shuffleInPlace(player.maneuverDeck);
    }

    const card = player.maneuverDeck.shift();
    if (!card) {
      break;
    }

    player.hand.push(card);
  }

  app.notice = `${player.name}'s hand was refilled up to ${app.state.rules.handSize}.`;
  persistSession();
  render();
}

function addCardToHand(playerKey, cardId) {
  if (!app.state || !cardId) {
    return;
  }

  stopAutoRun();
  const card = createCardFromLibrary(cardId);
  if (!card) {
    return;
  }

  app.state.players[playerKey].hand.push(card);
  app.notice = `Added ${card.name} to ${app.state.players[playerKey].name}'s hand.`;
  persistSession();
  render();
}

function replaceCardInHand(playerKey, handIndex, cardId) {
  if (!app.state || handIndex < 0 || !cardId) {
    return;
  }

  stopAutoRun();
  const card = createCardFromLibrary(cardId);
  if (!card || !app.state.players[playerKey].hand[handIndex]) {
    return;
  }

  app.state.players[playerKey].hand[handIndex] = card;
  app.notice = `${app.state.players[playerKey].name}'s hand slot ${handIndex + 1} is now ${card.name}.`;
  persistSession();
  render();
}

function removeCardFromHand(playerKey, handIndex) {
  if (!app.state || handIndex < 0) {
    return;
  }

  stopAutoRun();
  const removed = app.state.players[playerKey].hand.splice(handIndex, 1)[0];
  app.notice = removed
    ? `Removed ${removed.name} from ${app.state.players[playerKey].name}'s hand.`
    : app.notice;
  persistSession();
  render();
}

function createCardFromLibrary(cardId) {
  const entry = gameData.cardLibrary.find((item) => item.id === cardId);
  return entry ? Engine.normalizeCard(entry.card) : null;
}

function buildCardOptions(selectedId = "") {
  if (gameData.cardOptionCache.has(selectedId)) {
    return gameData.cardOptionCache.get(selectedId);
  }

  const markup = gameData.cardLibrary
    .map((entry) => {
      const selected = entry.id === selectedId ? " selected" : "";
      return `<option value="${escapeAttribute(entry.id)}"${selected}>${escapeHtml(buildCardLibraryLabel(entry))}</option>`;
    })
    .join("");

  gameData.cardOptionCache.set(selectedId, markup);
  return markup;
}

function playCardFromHand(playerKey, handIndex) {
  if (!app.state || handIndex < 0) {
    return;
  }

  stopAutoRun();
  const player = app.state.players[playerKey];
  const card = player.hand[handIndex];
  if (!card) {
    return;
  }

  try {
    if (
      app.state.phase === Engine.PHASES.CHOOSE_NEXT_ACTION &&
      app.state.turn.attackerKey === playerKey &&
      Engine.OFFENSIVE_TYPES.has(card.type)
    ) {
      Engine.playOffensiveCard(app.state, handIndex, playerKey);
      app.notice = `${player.name} played ${card.name}.`;
      persistSession();
      render();
      return;
    }

    if (
      app.state.resolution?.awaitingDefenceChoice &&
      app.state.resolution.defenderKey === playerKey &&
      Engine.DEFENSIVE_TYPES.has(card.type)
    ) {
      Engine.prepareDefence(app.state, handIndex);
      Engine.callDefenceCoin(app.state);
      app.notice = `${player.name} used ${card.name} on defence.`;
      persistSession();
      render();
    }
  } catch (error) {
    app.notice = error.message;
    render();
  }
}

function continueTurn() {
  if (!app.state || app.state.phase !== Engine.PHASES.TURN_END || app.state.match.over) {
    return;
  }

  stopAutoRun();
  Engine.continueAfterTurnEnd(app.state);
  app.notice = "Advanced to the next turn.";
  persistSession();
  render();
}

function drawPinfallCard() {
  if (!app.state || app.state.phase !== Engine.PHASES.PINFALL_DRAW || app.state.match.over) {
    return;
  }

  stopAutoRun();
  Engine.drawNextPinfallCard(app.state);
  app.notice = "Drew the next pinfall card.";
  persistSession();
  render();
}

function chooseNoDefence() {
  if (!app.state?.resolution?.awaitingDefenceChoice || app.state.match.over) {
    return;
  }

  stopAutoRun();
  Engine.chooseNoDefence(app.state);
  app.notice = "Chose no defence.";
  persistSession();
  render();
}

function canRunEnemyStep() {
  if (!app.state || app.state.match.over) {
    return false;
  }

  if (app.state.phase === Engine.PHASES.CHOOSE_NEXT_ACTION && app.state.turn.attackerKey === "enemy") {
    return true;
  }

  return Boolean(
    app.state.resolution &&
      app.state.resolution.defenderKey === "enemy" &&
      app.state.resolution.awaitingDefenceChoice
  );
}

function runEnemyStep() {
  if (!canRunEnemyStep()) {
    return;
  }

  stopAutoRun();

  if (app.state.phase === Engine.PHASES.CHOOSE_NEXT_ACTION && app.state.turn.attackerKey === "enemy") {
    runEnemyOffenceStep();
    return;
  }

  runEnemyDefenceStep();
}

function runEnemyOffenceStep() {
  const decision = Engine.chooseAiOffence(app.state, "enemy");

  if (decision.type === "stop") {
    Engine.stopTurn(app.state);
    app.notice = "Enemy AI stopped the turn.";
  } else {
    const card = app.state.players.enemy.hand[decision.handIndex];
    Engine.playOffensiveCard(app.state, decision.handIndex, "enemy");
    app.notice = `Enemy AI played ${card?.name || "a card"}.`;
  }

  persistSession();
  render();
}

function runEnemyDefenceStep() {
  const decision = Engine.chooseAiDefence(app.state);

  if (decision.type === "none") {
    Engine.chooseNoDefence(app.state);
    app.notice = "Enemy AI declined to defend.";
  } else {
    const card = app.state.players.enemy.hand[decision.handIndex];
    Engine.prepareDefence(app.state, decision.handIndex);
    Engine.callDefenceCoin(app.state);
    app.notice = `Enemy AI used ${card?.name || "a defence card"}.`;
  }

  persistSession();
  render();
}

function startAutoRunToPlayerChoice() {
  if (!app.state || app.state.match.over || app.autoRunTimer) {
    return;
  }

  app.notice = "Auto-running until the next player decision point.";
  render();
  scheduleAutoRunStep();
}

function scheduleAutoRunStep() {
  const delay = Math.max(0, Number(app.settings.aiStepDelay || 0));
  app.autoRunTimer = window.setTimeout(() => {
    app.autoRunTimer = null;
    runAutoStep();
  }, delay);
  renderActionButtons();
  renderSyncStatus();
}

function runAutoStep() {
  if (!app.state || app.state.match.over) {
    stopAutoRun();
    return;
  }

  if (app.state.phase === Engine.PHASES.TURN_END) {
    Engine.continueAfterTurnEnd(app.state);
    persistSession();
    render();
    if (shouldContinueAutoRun()) {
      scheduleAutoRunStep();
      return;
    }

    stopAutoRun("Auto-run reached a player choice.");
    return;
  }

  if (app.state.phase === Engine.PHASES.PINFALL_DRAW) {
    stopAutoRun("Auto-run paused for manual pinfall draws.");
    return;
  }

  if (canRunEnemyStep()) {
    if (app.state.turn.attackerKey === "enemy") {
      runEnemyOffenceStep();
    } else {
      runEnemyDefenceStep();
    }

    if (shouldContinueAutoRun()) {
      scheduleAutoRunStep();
      return;
    }

    stopAutoRun("Auto-run reached a player choice.");
    return;
  }

  stopAutoRun("Auto-run reached a manual decision.");
}

function shouldContinueAutoRun() {
  if (!app.state || app.state.match.over) {
    return false;
  }

  if (app.state.phase === Engine.PHASES.TURN_END) {
    return true;
  }

  if (app.state.phase === Engine.PHASES.PINFALL_DRAW) {
    return false;
  }

  if (app.state.phase === Engine.PHASES.CHOOSE_NEXT_ACTION && app.state.turn.attackerKey === "enemy") {
    return true;
  }

  return Boolean(
    app.state.resolution &&
      app.state.resolution.defenderKey === "enemy" &&
      app.state.resolution.awaitingDefenceChoice
  );
}

function stopAutoRun(message) {
  if (app.autoRunTimer) {
    window.clearTimeout(app.autoRunTimer);
    app.autoRunTimer = null;
  }

  if (message) {
    app.notice = message;
  }

  renderActionButtons();
  renderSyncStatus();
}

async function copyStateSnapshot() {
  const snapshot = {
    settings: app.settings,
    state: app.state ? Engine.serializeMatchState(app.state) : null
  };

  try {
    await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
    app.notice = "Copied the current debug snapshot to the clipboard.";
  } catch (error) {
    app.notice = "Clipboard copy failed in this browser context.";
  }

  renderRuleFeedback();
}

function renderFatalError(error) {
  document.body.innerHTML = `
    <main class="debug-shell">
      <section class="debug-card">
        <div class="debug-card__header">
          <div>
            <p class="debug-card__eyebrow">Startup</p>
            <h2>Debug page failed to load</h2>
          </div>
        </div>
        <p class="muted-copy">${escapeHtml(error.message)}</p>
      </section>
    </main>
  `;
}

function calculatePinChance(failCount, totalCount, drawCount) {
  if (failCount < drawCount || totalCount < drawCount) {
    return 0;
  }

  let chance = 1;
  for (let index = 0; index < drawCount; index += 1) {
    chance *= (failCount - index) / (totalCount - index);
  }

  return chance;
}

function getActiveSlot(state) {
  if (state.pinAttempt) {
    return state.pinAttempt.slot;
  }

  if (state.resolution) {
    return state.resolution.slot;
  }

  if (state.turn.nextSlot <= state.turn.slots.length) {
    return state.turn.nextSlot;
  }

  return state.turn.slots.length;
}

function shuffleInPlace(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = items[index];
    items[index] = items[swapIndex];
    items[swapIndex] = current;
  }
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}
