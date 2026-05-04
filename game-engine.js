(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }

  root.UnderCardEngine = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const HAND_SIZE = 6;
  const MAX_SEQUENCE_SLOTS = 3;
  const DAMAGE_PER_FAIL = 10;
  const PIN_DRAW_COUNT = 3;
  const STARTING_PIN_FAILS = 7;
  const STARTING_PIN_KICKOUTS = 5;
  const COIN_SIDES = ["Heads", "Tails"];

  const OFFENSIVE_TYPES = new Set(["attack", "taunt", "pin"]);
  const DEFENSIVE_TYPES = new Set(["dodge", "reversal"]);
  const RARITY_LIMITS = {
    common: 4,
    uncommon: 3,
    rare: 2,
    special: 1
  };

  const PHASES = {
    MATCH_START: "match_start",
    COIN_FLIP: "coin_flip",
    INITIAL_DRAW: "initial_draw",
    TURN_START: "turn_start",
    DRAW_PHASE: "draw_phase",
    CHOOSE_NEXT_ACTION: "choose_next_action",
    PLAY_CARD: "play_card",
    RESOLVE_ATTACK: "resolve_attack",
    RESOLVE_TAUNT: "resolve_taunt",
    RESOLVE_PIN: "resolve_pin",
    PIN_DEFENCE_DECISION: "pin_defence_decision",
    PINFALL_DRAW: "pinfall_draw",
    COMBO_CHECK: "combo_check",
    TURN_END: "turn_end",
    MATCH_END: "match_end"
  };

  function buildRules(overrides) {
    return {
      handSize: normalizeWholeNumber(overrides?.handSize, HAND_SIZE, 1),
      maxSequenceSlots: normalizeWholeNumber(overrides?.maxSequenceSlots, MAX_SEQUENCE_SLOTS, 1),
      damagePerFail: normalizeWholeNumber(overrides?.damagePerFail, DAMAGE_PER_FAIL, 1),
      pinDrawCount: normalizeWholeNumber(overrides?.pinDrawCount, PIN_DRAW_COUNT, 1),
      startingPinFails: normalizeWholeNumber(overrides?.startingPinFails, STARTING_PIN_FAILS, 0),
      startingPinKickouts: normalizeWholeNumber(overrides?.startingPinKickouts, STARTING_PIN_KICKOUTS, 0)
    };
  }

  function normalizeWholeNumber(value, fallback, minimum) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }

    return Math.max(minimum, Math.floor(numeric));
  }

  function createMatch(config) {
    const random = createRandomSource(config?.random);
    const rules = buildRules(config?.rules);
    const player = createPlayerState("player", config?.player, random, rules);
    const enemy = createPlayerState("enemy", config?.enemy, random, rules);
    const state = {
      phase: "",
      phaseHistory: [],
      rules,
      players: {
        player,
        enemy
      },
      initiative: {
        winnerKey: null,
        loserKey: null,
        coinResult: null
      },
      turn: null,
      resolution: null,
      pinAttempt: null,
      pendingTurnStart: null,
      log: [],
      status: "",
      outcome: "",
      match: {
        over: false,
        winnerKey: null,
        loserKey: null,
        reason: ""
      },
      meta: {
        random,
        rollOffId: 0
      },
      lastDefenceRoll: null
    };

    transitionTo(state, PHASES.MATCH_START);
    addLog(state, "Match start.");

    transitionTo(state, PHASES.COIN_FLIP);
    const initiativeWinner = config?.initiativeWinner || resolveInitiativeWinner(state);
    const initiativeLoser = getOpponentKey(initiativeWinner);
    state.initiative.winnerKey = initiativeWinner;
    state.initiative.loserKey = initiativeLoser;
    addLog(
      state,
      `${getPlayer(state, initiativeWinner).name} wins the coin flip and takes initiative.`
    );

    transitionTo(state, PHASES.INITIAL_DRAW);
    const playerOpeningDraw = drawToHand(state, "player", state.rules.handSize);
    const enemyOpeningDraw = drawToHand(state, "enemy", state.rules.handSize);
    addLog(
      state,
      `${getPlayer(state, "player").name} draws ${playerOpeningDraw.drawn} cards for the opening hand.`
    );
    addLog(
      state,
      `${getPlayer(state, "enemy").name} draws ${enemyOpeningDraw.drawn} cards for the opening hand.`
    );

    startTurn(state, initiativeWinner, 1);
    return state;
  }

  function createPlayerState(key, config, random, rules) {
    const maneuverDeck = cloneCardList(config?.maneuverDeck || []);
    const discardPile = cloneCardList(config?.discardPile || []);
    const exhaustPile = cloneCardList(config?.exhaustPile || []);
    const hand = cloneCardList(config?.hand || []);
    const pinfallDeck = Array.isArray(config?.pinfallDeck)
      ? clonePinfallDeck(config.pinfallDeck, rules)
      : shuffleArray(clonePinfallDeck([], rules), random);

    return {
      key,
      name: config?.name || capitalize(key),
      maneuverDeck: shouldShuffle(config?.shuffleManeuverDeck) ? shuffleArray(maneuverDeck, random) : maneuverDeck,
      hand,
      discardPile,
      exhaustPile,
      pinfallDeck,
      damage: Number(config?.damage || 0),
      failThresholdsReached: Math.floor(Number(config?.damage || 0) / rules.damagePerFail)
    };
  }

  function shouldShuffle(flag) {
    return flag === undefined ? false : Boolean(flag);
  }

  function resolveInitiativeWinner(state) {
    const result = flipCoins(state, 1)[0];
    state.initiative.coinResult = result;
    return result === "Heads" ? "player" : "enemy";
  }

  function startTurn(state, attackerKey, turnNumber) {
    if (state.match.over) {
      return state;
    }

    const defenderKey = getOpponentKey(attackerKey);
    state.resolution = null;
    state.pinAttempt = null;
    state.pendingTurnStart = null;
    state.turn = createTurnState(attackerKey, defenderKey, turnNumber, state.rules);

    transitionTo(state, PHASES.TURN_START);
    addLog(
      state,
      `Turn ${turnNumber}: ${getPlayer(state, attackerKey).name} attacks ${getPlayer(state, defenderKey).name}.`
    );

    transitionTo(state, PHASES.DRAW_PHASE);
    const drawResult = drawToHand(state, attackerKey, state.rules.handSize);
    if (drawResult.drawn > 0) {
      addLog(
        state,
        `${getPlayer(state, attackerKey).name} draws ${drawResult.drawn} ${pluralize("card", drawResult.drawn)}.`
      );
    }

    transitionToChooseNextAction(state);
    return state;
  }

  function createTurnState(attackerKey, defenderKey, number, rules) {
    return {
      number,
      attackerKey,
      defenderKey,
      nextSlot: 1,
      playsUsed: 0,
      endedEarly: false,
      endReason: "",
      playedPin: false,
      comboAchieved: false,
      slots: Array.from({ length: rules.maxSequenceSlots }, (_, index) => {
        return createTurnSlot(index + 1);
      })
    };
  }

  function createTurnSlot(slotNumber) {
    return {
      slot: slotNumber,
      card: null,
      ownerKey: null,
      onSlot: null,
      result: "Open",
      countedForCombo: false,
      destination: null,
      defence: null
    };
  }

  function serializeMatchState(state) {
    if (!state) {
      return null;
    }

    return {
      phase: state.phase,
      phaseHistory: Array.isArray(state.phaseHistory) ? [...state.phaseHistory] : [],
      rules: buildRules(state.rules),
      players: {
        player: serializePlayerState(state.players?.player),
        enemy: serializePlayerState(state.players?.enemy)
      },
      initiative: {
        winnerKey: state.initiative?.winnerKey || null,
        loserKey: state.initiative?.loserKey || null,
        coinResult: state.initiative?.coinResult || null
      },
      turn: serializeTurnState(state.turn),
      resolution: serializeResolutionState(state.resolution),
      pinAttempt: serializePinAttemptState(state.pinAttempt),
      pendingTurnStart: state.pendingTurnStart
        ? {
            attackerKey: state.pendingTurnStart.attackerKey,
            number: Number(state.pendingTurnStart.number || 0)
          }
        : null,
      log: Array.isArray(state.log) ? [...state.log] : [],
      status: String(state.status || ""),
      outcome: String(state.outcome || ""),
      match: {
        over: Boolean(state.match?.over),
        winnerKey: state.match?.winnerKey || null,
        loserKey: state.match?.loserKey || null,
        reason: String(state.match?.reason || "")
      },
      meta: {
        rollOffId: Number(state.meta?.rollOffId || 0)
      },
      lastDefenceRoll: serializeLastDefenceRoll(state.lastDefenceRoll)
    };
  }

  function serializePlayerState(player) {
    if (!player) {
      return null;
    }

    return {
      key: player.key,
      name: player.name,
      maneuverDeck: cloneCardList(player.maneuverDeck),
      hand: cloneCardList(player.hand),
      discardPile: cloneCardList(player.discardPile),
      exhaustPile: cloneCardList(player.exhaustPile),
      pinfallDeck: clonePinfallDeck(player.pinfallDeck, buildRules()),
      damage: Number(player.damage || 0),
      failThresholdsReached: Number(player.failThresholdsReached || 0)
    };
  }

  function serializeTurnState(turn) {
    if (!turn) {
      return null;
    }

    return {
      number: Number(turn.number || 0),
      attackerKey: turn.attackerKey,
      defenderKey: turn.defenderKey,
      nextSlot: Number(turn.nextSlot || 1),
      playsUsed: Number(turn.playsUsed || 0),
      endedEarly: Boolean(turn.endedEarly),
      endReason: turn.endReason || "",
      playedPin: Boolean(turn.playedPin),
      comboAchieved: Boolean(turn.comboAchieved),
      slots: Array.isArray(turn.slots) ? turn.slots.map(serializeTurnSlot) : []
    };
  }

  function serializeTurnSlot(slot) {
    return {
      slot: Number(slot.slot || 0),
      card: slot.card ? cloneCard(slot.card) : null,
      ownerKey: slot.ownerKey || null,
      onSlot: slot.onSlot === null ? null : Boolean(slot.onSlot),
      result: slot.result || "Open",
      countedForCombo: Boolean(slot.countedForCombo),
      destination: slot.destination || null,
      defence: slot.defence
        ? {
            actorKey: slot.defence.actorKey || null,
            choice: slot.defence.choice || "none",
            cardName: slot.defence.cardName || "",
            call: slot.defence.call || null,
            flips: Array.isArray(slot.defence.flips) ? [...slot.defence.flips] : [],
            success:
              slot.defence.success === null || slot.defence.success === undefined
                ? null
                : Boolean(slot.defence.success),
            coinMode: slot.defence.coinMode || "normal"
          }
        : null
    };
  }

  function serializeResolutionState(resolution) {
    if (!resolution) {
      return null;
    }

    return {
      kind: resolution.kind,
      card: resolution.card ? cloneCard(resolution.card) : null,
      cardOwnerKey: resolution.cardOwnerKey,
      attackerKey: resolution.attackerKey,
      defenderKey: resolution.defenderKey,
      slot: Number(resolution.slot || 0),
      onSlot: resolution.onSlot === null ? null : Boolean(resolution.onSlot),
      awaitingDefenceChoice: Boolean(resolution.awaitingDefenceChoice),
      awaitingCoinCall: Boolean(resolution.awaitingCoinCall),
      defence: resolution.defence
        ? {
            actorKey: resolution.defence.actorKey,
            choice: resolution.defence.choice,
            card: resolution.defence.card ? cloneCard(resolution.defence.card) : null,
            coinMode: resolution.defence.coinMode || "normal",
            call: resolution.defence.call || null,
            flips: Array.isArray(resolution.defence.flips) ? [...resolution.defence.flips] : [],
            attackerRoll: Number(resolution.defence.attackerRoll || 0),
            defenderRoll: Number(resolution.defence.defenderRoll || 0),
            success:
              resolution.defence.success === null || resolution.defence.success === undefined
                ? null
                : Boolean(resolution.defence.success)
          }
        : null,
      pinHistory: Array.isArray(resolution.pinHistory)
        ? resolution.pinHistory.map((entry) => ({ ...entry }))
        : []
    };
  }

  function serializePinAttemptState(pinAttempt) {
    if (!pinAttempt) {
      return null;
    }

    return {
      attackerKey: pinAttempt.attackerKey,
      defenderKey: pinAttempt.defenderKey,
      card: pinAttempt.card ? cloneCard(pinAttempt.card) : null,
      slot: Number(pinAttempt.slot || 0),
      drawnCards: Array.isArray(pinAttempt.drawnCards) ? [...pinAttempt.drawnCards] : [],
      destination: pinAttempt.destination || null
    };
  }

  function serializeLastDefenceRoll(roll) {
    if (!roll) {
      return null;
    }

    return {
      id: Number(roll.id || 0),
      attackerName: roll.attackerName || "",
      defenderName: roll.defenderName || "",
      attackerRoll: Number(roll.attackerRoll || 0),
      defenderRoll: Number(roll.defenderRoll || 0),
      defenderRolls: Array.isArray(roll.defenderRolls) ? [...roll.defenderRolls] : [],
      mode: roll.mode || "normal",
      defenceChoice: roll.defenceChoice || "",
      winnerName: roll.winnerName || ""
    };
  }

  function hydrateMatchState(snapshot, options) {
    if (!snapshot) {
      return null;
    }

    const random = createRandomSource(options?.random);
    const rules = buildRules(snapshot.rules);

    return {
      phase: snapshot.phase || "",
      phaseHistory: Array.isArray(snapshot.phaseHistory) ? [...snapshot.phaseHistory] : [],
      rules,
      players: {
        player: hydratePlayerState("player", snapshot.players?.player, random, rules),
        enemy: hydratePlayerState("enemy", snapshot.players?.enemy, random, rules)
      },
      initiative: {
        winnerKey: snapshot.initiative?.winnerKey || null,
        loserKey: snapshot.initiative?.loserKey || null,
        coinResult: snapshot.initiative?.coinResult || null
      },
      turn: hydrateTurnState(snapshot.turn, rules),
      resolution: hydrateResolutionState(snapshot.resolution),
      pinAttempt: hydratePinAttemptState(snapshot.pinAttempt),
      pendingTurnStart: snapshot.pendingTurnStart
        ? {
            attackerKey: snapshot.pendingTurnStart.attackerKey,
            number: Number(snapshot.pendingTurnStart.number || 0)
          }
        : null,
      log: Array.isArray(snapshot.log) ? [...snapshot.log] : [],
      status: String(snapshot.status || ""),
      outcome: String(snapshot.outcome || ""),
      match: {
        over: Boolean(snapshot.match?.over),
        winnerKey: snapshot.match?.winnerKey || null,
        loserKey: snapshot.match?.loserKey || null,
        reason: String(snapshot.match?.reason || "")
      },
      meta: {
        random,
        rollOffId: Number(snapshot.meta?.rollOffId || 0)
      },
      lastDefenceRoll: serializeLastDefenceRoll(snapshot.lastDefenceRoll)
    };
  }

  function hydratePlayerState(key, snapshot, random, rules) {
    const player = createPlayerState(
      key,
      {
        name: snapshot?.name,
        maneuverDeck: snapshot?.maneuverDeck || [],
        hand: snapshot?.hand || [],
        discardPile: snapshot?.discardPile || [],
        exhaustPile: snapshot?.exhaustPile || [],
        pinfallDeck: snapshot?.pinfallDeck || [],
        damage: snapshot?.damage || 0,
        shuffleManeuverDeck: false
      },
      random,
      rules
    );

    player.failThresholdsReached =
      snapshot && Number.isFinite(Number(snapshot.failThresholdsReached))
        ? Number(snapshot.failThresholdsReached)
        : Math.floor(player.damage / rules.damagePerFail);
    return player;
  }

  function hydrateTurnState(turn, rules) {
    if (!turn) {
      return null;
    }

    return {
      number: Number(turn.number || 0),
      attackerKey: turn.attackerKey,
      defenderKey: turn.defenderKey,
      nextSlot: Number(turn.nextSlot || 1),
      playsUsed: Number(turn.playsUsed || 0),
      endedEarly: Boolean(turn.endedEarly),
      endReason: turn.endReason || "",
      playedPin: Boolean(turn.playedPin),
      comboAchieved: Boolean(turn.comboAchieved),
      slots: Array.isArray(turn.slots) && turn.slots.length > 0
        ? turn.slots.map((slot) => {
            return {
              slot: Number(slot.slot || 0),
              card: slot.card ? cloneCard(slot.card) : null,
              ownerKey: slot.ownerKey || null,
              onSlot: slot.onSlot === null ? null : Boolean(slot.onSlot),
              result: slot.result || "Open",
              countedForCombo: Boolean(slot.countedForCombo),
              destination: slot.destination || null,
              defence: slot.defence
                ? {
                    actorKey: slot.defence.actorKey || null,
                    choice: slot.defence.choice || "none",
                    cardName: slot.defence.cardName || "",
                    call: slot.defence.call || null,
                    flips: Array.isArray(slot.defence.flips) ? [...slot.defence.flips] : [],
                    success:
                      slot.defence.success === null || slot.defence.success === undefined
                        ? null
                        : Boolean(slot.defence.success),
                    coinMode: slot.defence.coinMode || "normal"
                  }
                : null
            };
          })
        : Array.from({ length: rules.maxSequenceSlots }, (_, index) => createTurnSlot(index + 1))
    };
  }

  function hydrateResolutionState(resolution) {
    if (!resolution) {
      return null;
    }

    return {
      kind: resolution.kind,
      card: resolution.card ? cloneCard(resolution.card) : null,
      cardOwnerKey: resolution.cardOwnerKey,
      attackerKey: resolution.attackerKey,
      defenderKey: resolution.defenderKey,
      slot: Number(resolution.slot || 0),
      onSlot: resolution.onSlot === null ? null : Boolean(resolution.onSlot),
      awaitingDefenceChoice: Boolean(resolution.awaitingDefenceChoice),
      awaitingCoinCall: Boolean(resolution.awaitingCoinCall),
      defence: resolution.defence
        ? {
            actorKey: resolution.defence.actorKey,
            choice: resolution.defence.choice,
            card: resolution.defence.card ? cloneCard(resolution.defence.card) : null,
            coinMode: resolution.defence.coinMode || "normal",
            call: resolution.defence.call || null,
            flips: Array.isArray(resolution.defence.flips) ? [...resolution.defence.flips] : [],
            attackerRoll: Number(resolution.defence.attackerRoll || 0),
            defenderRoll: Number(resolution.defence.defenderRoll || 0),
            success:
              resolution.defence.success === null || resolution.defence.success === undefined
                ? null
                : Boolean(resolution.defence.success)
          }
        : null,
      pinHistory: Array.isArray(resolution.pinHistory)
        ? resolution.pinHistory.map((entry) => ({ ...entry }))
        : []
    };
  }

  function hydratePinAttemptState(pinAttempt) {
    if (!pinAttempt) {
      return null;
    }

    return {
      attackerKey: pinAttempt.attackerKey,
      defenderKey: pinAttempt.defenderKey,
      card: pinAttempt.card ? cloneCard(pinAttempt.card) : null,
      slot: Number(pinAttempt.slot || 0),
      drawnCards: Array.isArray(pinAttempt.drawnCards) ? [...pinAttempt.drawnCards] : [],
      destination: pinAttempt.destination || null
    };
  }

  function updateRules(state, inputRules) {
    assertActiveMatch(state);

    const previousRules = buildRules(state.rules);
    const nextRules = buildRules({ ...previousRules, ...(inputRules || {}) });
    const warnings = [];

    state.rules = nextRules;

    if (state.turn) {
      syncTurnSlotsToRules(state, previousRules, nextRules, warnings);
    }

    reconcileDamageThresholdsToRules(state, previousRules, nextRules);

    if (state.pinAttempt && state.pinAttempt.drawnCards.length >= nextRules.pinDrawCount) {
      warnings.push("Current pinfall draw already meets the new draw target. Finish the pin sequence manually.");
    }

    return {
      previousRules,
      rules: nextRules,
      warnings
    };
  }

  function syncTurnSlotsToRules(state, previousRules, nextRules, warnings) {
    const currentSlots = Array.isArray(state.turn.slots) ? state.turn.slots : [];

    if (nextRules.maxSequenceSlots > currentSlots.length) {
      for (let index = currentSlots.length; index < nextRules.maxSequenceSlots; index += 1) {
        currentSlots.push(createTurnSlot(index + 1));
      }
      return;
    }

    if (nextRules.maxSequenceSlots >= currentSlots.length) {
      return;
    }

    const trimmedSlots = currentSlots.slice(nextRules.maxSequenceSlots);
    const hasOccupiedTrimmedSlot = trimmedSlots.some((slot) => slot.card);

    if (hasOccupiedTrimmedSlot) {
      warnings.push("Occupied slots stay visible until the current turn ends. The new slot cap applies on the next turn.");
      return;
    }

    state.turn.slots = currentSlots.slice(0, nextRules.maxSequenceSlots);
    state.turn.nextSlot = Math.min(state.turn.nextSlot, nextRules.maxSequenceSlots + 1);
  }

  function reconcileDamageThresholdsToRules(state, previousRules, nextRules) {
    if (previousRules.damagePerFail === nextRules.damagePerFail) {
      return;
    }

    ["player", "enemy"].forEach((playerKey) => {
      const player = getPlayer(state, playerKey);
      const previousThresholds = Number(player.failThresholdsReached || 0);
      const nextThresholds = Math.floor(player.damage / nextRules.damagePerFail);

      if (nextThresholds > previousThresholds) {
        addPinfallCards(state, playerKey, "Fail", nextThresholds - previousThresholds, "rule change");
      }

      player.failThresholdsReached = nextThresholds;
    });
  }

  function drawToHand(state, playerKey, targetSize) {
    const player = getPlayer(state, playerKey);
    let drawn = 0;

    while (player.hand.length < targetSize) {
      if (player.maneuverDeck.length === 0) {
        if (player.discardPile.length === 0) {
          break;
        }

        player.maneuverDeck = shuffleArray(player.discardPile.splice(0), state.meta.random);
        addLog(state, `${player.name} reshuffles the discard pile into the maneuver deck.`);
      }

      if (player.maneuverDeck.length === 0) {
        break;
      }

      player.hand.push(player.maneuverDeck.shift());
      drawn += 1;
    }

    return { drawn };
  }

  function transitionToChooseNextAction(state) {
    if (state.match.over) {
      return state;
    }

    state.resolution = null;
    transitionTo(state, PHASES.CHOOSE_NEXT_ACTION);
    state.status = `${getCurrentAttacker(state).name} chooses the next action.`;
    state.outcome = "";

    if (!hasPlayableOffense(state, state.turn.attackerKey)) {
      addLog(
        state,
        `${getCurrentAttacker(state).name} has no offensive card for slot ${state.turn.nextSlot}.`
      );
      finishTurn(state, "no_playable_offense");
    }

    return state;
  }

  function playOffensiveCard(state, handIndex, actorKey) {
    assertActiveMatch(state);
    assertPhase(state, PHASES.CHOOSE_NEXT_ACTION);

    const activeActorKey = actorKey || state.turn.attackerKey;
    if (activeActorKey !== state.turn.attackerKey) {
      throw new Error("Only the current attacker can play an offensive card.");
    }

    const attacker = getPlayer(state, activeActorKey);
    const defenderKey = state.turn.defenderKey;
    const card = attacker.hand[handIndex];

    if (!card || !OFFENSIVE_TYPES.has(card.type)) {
      throw new Error("Selected card is not a playable offensive card.");
    }

    const slot = state.turn.nextSlot;
    const slotRecord = state.turn.slots[slot - 1];
    const onSlot = card.type === "pin" ? null : doesCardMatchSlot(card, slot);

    attacker.hand.splice(handIndex, 1);
    state.turn.playsUsed += 1;
    state.turn.nextSlot += 1;

    slotRecord.card = cloneCard(card);
    slotRecord.ownerKey = activeActorKey;
    slotRecord.onSlot = onSlot;
    slotRecord.result = "Resolving";
    slotRecord.destination = null;
    slotRecord.defence = null;

    transitionTo(state, PHASES.PLAY_CARD);
    addLog(
      state,
      `${attacker.name} plays ${card.name} into slot ${slot}${formatSlotStatus(onSlot)}.`
    );

    state.resolution = {
      kind: card.type,
      card,
      cardOwnerKey: activeActorKey,
      attackerKey: activeActorKey,
      defenderKey,
      slot,
      onSlot,
      awaitingDefenceChoice: false,
      awaitingCoinCall: false,
      defence: null,
      pinHistory: []
    };

    if (card.type === "attack") {
      transitionTo(state, PHASES.RESOLVE_ATTACK);
      beginAttackResolution(state);
      return state;
    }

    if (card.type === "taunt") {
      transitionTo(state, PHASES.RESOLVE_TAUNT);
      resolveTaunt(state);
      return state;
    }

    state.turn.playedPin = true;
    transitionTo(state, PHASES.RESOLVE_PIN);
    beginPinResolution(state);
    return state;
  }

  function beginAttackResolution(state) {
    const defenderKey = state.resolution.defenderKey;
    if (getDefenseOptions(state, defenderKey).length === 0) {
      recordNoDefence(state);
      resolveAttackLanding(state);
      return;
    }

    state.resolution.awaitingDefenceChoice = true;
    state.status = `${getPlayer(state, defenderKey).name} chooses a defence.`;
    state.outcome = state.resolution.onSlot ? "Normal defence odds." : "Defender has advantage.";
  }

  function beginPinResolution(state) {
    addLog(state, `${getCurrentAttacker(state).name}'s offensive sequence ends on the pin attempt.`);

    if (getDefenseOptions(state, state.resolution.defenderKey).length === 0) {
      recordNoDefence(state);
      landPin(state);
      return;
    }

    transitionTo(state, PHASES.PIN_DEFENCE_DECISION);
    state.resolution.awaitingDefenceChoice = true;
    state.status = `${getPlayer(state, state.resolution.defenderKey).name} chooses how to answer the pin.`;
    state.outcome = "Choose dodge, reversal, or no defence.";
  }

  function chooseNoDefence(state) {
    assertActiveMatch(state);
    assertAwaitingDefenceChoice(state);

    recordNoDefence(state);

    if (state.resolution.kind === "attack") {
      resolveAttackLanding(state);
      return state;
    }

    landPin(state);
    return state;
  }

  function prepareDefence(state, handIndex) {
    assertActiveMatch(state);
    assertAwaitingDefenceChoice(state);

    const defender = getPlayer(state, state.resolution.defenderKey);
    const defenceCard = defender.hand[handIndex];

    if (!defenceCard || !DEFENSIVE_TYPES.has(defenceCard.type)) {
      throw new Error("Selected card is not a playable defence card.");
    }

    defender.hand.splice(handIndex, 1);
    state.resolution.awaitingDefenceChoice = false;
    state.resolution.awaitingCoinCall = true;
    state.resolution.defence = {
      actorKey: state.resolution.defenderKey,
      choice: defenceCard.type,
      card: defenceCard,
      coinMode: getDefenceCoinMode(state.resolution),
      call: null,
      flips: [],
      success: null
    };

    updateSlotDefence(state, {
      actorKey: state.resolution.defenderKey,
      choice: defenceCard.type,
      cardName: defenceCard.name,
      call: null,
      flips: [],
      success: null,
      coinMode: state.resolution.defence.coinMode
    });

    state.status = `${defender.name} readies ${defenceCard.name}.`;
    state.outcome = buildCoinModeDescription(state.resolution.defence.coinMode);
    addLog(state, `${defender.name} readies ${defenceCard.name}.`);
    return state;
  }

  function callDefenceCoin(state) {
    assertActiveMatch(state);
    if (!state.resolution || !state.resolution.awaitingCoinCall || !state.resolution.defence) {
      throw new Error("There is no defence coin call to resolve.");
    }

    const defence = state.resolution.defence;
    const attackerKey = state.resolution.attackerKey;
    const defenderKey = state.resolution.defenderKey;
    const rollCount = defence.coinMode === "normal" ? 1 : 2;
    let attackerRoll = 0;
    let defenderRoll = 0;
    let defenderRolls = [];

    do {
      attackerRoll = rollD20(state);
      defenderRolls = Array.from({ length: rollCount }, () => rollD20(state));
      defenderRoll =
        defence.coinMode === "advantage"
          ? Math.max(...defenderRolls)
          : defence.coinMode === "disadvantage"
            ? Math.min(...defenderRolls)
            : defenderRolls[0];
    } while (attackerRoll === defenderRoll);

    defence.call = null;
    defence.flips = defenderRolls.slice();
    defence.attackerRoll = attackerRoll;
    defence.defenderRoll = defenderRoll;
    defence.success = defenderRoll > attackerRoll;

    updateSlotDefence(state, {
      actorKey: defence.actorKey,
      choice: defence.choice,
      cardName: defence.card.name,
      call: null,
      flips: defenderRolls.slice(),
      attackerRoll,
      defenderRoll,
      success: defence.success,
      coinMode: defence.coinMode
    });

    const defender = getPlayer(state, defenderKey);
    const attacker = getPlayer(state, attackerKey);
    const defenderRollText =
      defence.coinMode === "normal"
        ? String(defenderRoll)
        : `${defenderRoll} (from ${defenderRolls.join(" / ")})`;
    addLog(
      state,
      `${attacker.name} rolls ${attackerRoll}. ${defender.name} rolls ${defenderRollText} with ${defence.card.name}.`
    );
    state.lastDefenceRoll = {
      id: (state.meta.rollOffId += 1),
      attackerName: attacker.name,
      defenderName: defender.name,
      attackerRoll,
      defenderRoll,
      defenderRolls: defenderRolls.slice(),
      mode: defence.coinMode,
      defenceChoice: defence.choice,
      winnerName: defence.success ? defender.name : attacker.name
    };

    state.resolution.awaitingCoinCall = false;

    if (state.resolution.kind === "attack") {
      resolveAttackDefenceResult(state);
      return state;
    }

    resolvePinDefenceResult(state);
    return state;
  }

  function resolveAttackDefenceResult(state) {
    const defence = state.resolution.defence;
    const defender = getPlayer(state, state.resolution.defenderKey);
    const attacker = getPlayer(state, state.resolution.attackerKey);

    moveCardAfterUse(state, defence.actorKey, defence.card);

    if (defence.success) {
      const attackCard = state.resolution.card;
      const counterDamage = defence.choice === "dodge" ? Number(attackCard.missDamage || 0) : Number(attackCard.reverseDamage || 0);
      if (counterDamage > 0) {
        const damageResult = applyDamage(state, state.resolution.attackerKey, counterDamage);
        logDamageThresholds(state, state.resolution.attackerKey, damageResult);
      }

      addLog(
        state,
        `${defender.name} ${defence.choice === "dodge" ? "dodges" : "reverses"} ${state.resolution.card.name}. ${attacker.name}'s turn ends immediately. Counter-damage to ${attacker.name}: ${counterDamage}.`
      );

      finalizeAttackCard(state, `Defended by ${capitalize(defence.choice)}`);
      finishTurn(state, "successful_defence");
      return;
    }

    addLog(
      state,
      `${defender.name}'s ${defence.card.name} fails and ${state.resolution.card.name} lands.`
    );
    resolveAttackLanding(state);
  }

  function resolveAttackLanding(state) {
    const resolution = state.resolution;
    const attacker = getPlayer(state, resolution.attackerKey);
    const defender = getPlayer(state, resolution.defenderKey);
    const damage = computeAttackDamage(resolution.card, resolution.onSlot);

    if (damage > 0) {
      const damageResult = applyDamage(state, resolution.defenderKey, damage);
      addLog(
        state,
        `${attacker.name} lands ${resolution.card.name}${formatSlotStatus(resolution.onSlot)} for ${damage} damage on ${defender.name}.`
      );
      logDamageThresholds(state, resolution.defenderKey, damageResult);
    } else {
      addLog(
        state,
        `${attacker.name} lands ${resolution.card.name}${formatSlotStatus(resolution.onSlot)} for no damage.`
      );
    }

    applyEffects(
      state,
      extractAfterDamageEffects(resolution.card, resolution.onSlot, "attack"),
      resolution.attackerKey,
      resolution.defenderKey,
      resolution.card.name
    );

    finalizeAttackCard(state, "Landed");
    advanceAfterResolvedOffense(state);
  }

  function finalizeAttackCard(state, resultLabel) {
    const resolution = state.resolution;
    const slotRecord = getTurnSlot(state, resolution.slot);
    const destination = moveCardAfterUse(state, resolution.attackerKey, resolution.card);

    slotRecord.result = resultLabel;
    slotRecord.destination = destination;
    slotRecord.countedForCombo = Boolean(resolution.onSlot && resultLabel === "Landed");
    state.status = slotRecord.result;
  }

  function resolveTaunt(state) {
    const resolution = state.resolution;
    const attacker = getPlayer(state, resolution.attackerKey);
    const defender = getPlayer(state, resolution.defenderKey);
    const effects = resolution.onSlot ? resolution.card.onSlotEffect : resolution.card.offSlotEffect;

    addLog(
      state,
      `${attacker.name} uses ${resolution.card.name}${formatSlotStatus(resolution.onSlot)}. ${resolution.onSlot ? "On-slot effect." : "Reduced off-slot effect."}`
    );
    applyEffects(state, effects, resolution.attackerKey, resolution.defenderKey, resolution.card.name);
    const destination = moveCardAfterUse(state, resolution.attackerKey, resolution.card);
    const slotRecord = getTurnSlot(state, resolution.slot);

    slotRecord.result = resolution.onSlot ? "Taunt resolved" : "Taunt resolved off-slot";
    slotRecord.destination = destination;
    slotRecord.countedForCombo = Boolean(resolution.onSlot);
    state.status = `${attacker.name} resolves ${resolution.card.name}.`;
    state.outcome = `${defender.name} cannot defend taunts.`;

    advanceAfterResolvedOffense(state);
  }

  function resolvePinDefenceResult(state) {
    const defence = state.resolution.defence;
    const defender = getPlayer(state, state.resolution.defenderKey);
    const attacker = getPlayer(state, state.resolution.attackerKey);

    moveCardAfterUse(state, defence.actorKey, defence.card);

    if (!defence.success) {
      addLog(
        state,
        `${defender.name}'s ${defence.card.name} fails and the pin lands on ${defender.name}.`
      );
      landPin(state);
      return;
    }

    if (defence.choice === "dodge") {
      addLog(state, `${defender.name} dodges the pin from ${attacker.name}.`);
      const destination = moveCardAfterUse(state, state.resolution.cardOwnerKey, state.resolution.card);
      finalizePinCard(state, `${defender.name} dodged the pin`, destination);
      finishTurn(state, "pin");
      return;
    }

    addLog(state, `${defender.name} reverses the pin onto ${attacker.name}.`);
    state.resolution.pinHistory.push({
      from: defender.key,
      to: attacker.key,
      with: defence.card.name
    });

    const originalAttackerKey = state.resolution.attackerKey;
    state.resolution.attackerKey = state.resolution.defenderKey;
    state.resolution.defenderKey = originalAttackerKey;
    state.resolution.awaitingDefenceChoice = false;
    state.resolution.awaitingCoinCall = false;
    state.resolution.defence = null;

    transitionTo(state, PHASES.PIN_DEFENCE_DECISION);

    if (getDefenseOptions(state, state.resolution.defenderKey).length === 0) {
      recordNoDefence(state);
      landPin(state);
      return;
    }

    state.resolution.awaitingDefenceChoice = true;
    state.status = `${getPlayer(state, state.resolution.defenderKey).name} answers the reversed pin.`;
    state.outcome = "The pin can keep chaining.";
  }

  function landPin(state) {
    const resolution = state.resolution;
    applyEffects(
      state,
      resolution.card.onPinEffects,
      resolution.attackerKey,
      resolution.defenderKey,
      resolution.card.name
    );

    const destination = moveCardAfterUse(state, resolution.cardOwnerKey, resolution.card);
    finalizePinCard(state, `${getPlayer(state, resolution.defenderKey).name} is pinned`, destination);

    state.pinAttempt = {
      attackerKey: resolution.attackerKey,
      defenderKey: resolution.defenderKey,
      card: cloneCard(resolution.card),
      slot: resolution.slot,
      drawnCards: [],
      destination
    };

    transitionTo(state, PHASES.PINFALL_DRAW);
    state.status = `${getPlayer(state, resolution.defenderKey).name} draws from the pinfall deck.`;
    state.outcome = `Draw ${state.rules.pinDrawCount} cards one at a time. Kickout ends the pin.`;
    addLog(
      state,
      `${getPlayer(state, resolution.defenderKey).name} must draw ${state.rules.pinDrawCount} pinfall cards.`
    );
    state.resolution = null;
  }

  function finalizePinCard(state, resultLabel, destination) {
    const slotNumber = state.resolution?.slot || state.pinAttempt?.slot || state.turn.playsUsed;
    const slotRecord = getTurnSlot(state, slotNumber);
    slotRecord.result = resultLabel;
    slotRecord.countedForCombo = false;
    if (destination) {
      slotRecord.destination = destination;
    }
  }

  function drawNextPinfallCard(state) {
    assertActiveMatch(state);
    assertPhase(state, PHASES.PINFALL_DRAW);

    const attempt = state.pinAttempt;
    const defender = getPlayer(state, attempt.defenderKey);
    const attacker = getPlayer(state, attempt.attackerKey);
    const card = defender.pinfallDeck.shift();

    if (!card) {
      throw new Error("Pinfall deck is empty.");
    }

    attempt.drawnCards.push(card);
    addLog(state, `Count ${attempt.drawnCards.length}: ${card}.`);

    if (card === "Kickout") {
      defender.pinfallDeck = shuffleArray(defender.pinfallDeck.concat(attempt.drawnCards), state.meta.random);
      addLog(state, `${defender.name} kicks out and the revealed pinfall cards go back into the deck.`);
      state.pinAttempt = null;
      finishTurn(state, "pin");
      return state;
    }

    if (attempt.drawnCards.length >= state.rules.pinDrawCount) {
      endMatch(
        state,
        attempt.attackerKey,
        `${attacker.name} wins by pinfall with ${attempt.card.name}.`
      );
      return state;
    }

    state.status = `${defender.name} continues the pinfall draw.`;
    state.outcome = `${state.rules.pinDrawCount - attempt.drawnCards.length} card${state.rules.pinDrawCount - attempt.drawnCards.length === 1 ? "" : "s"} left.`;
    return state;
  }

  function stopTurn(state) {
    assertActiveMatch(state);
    assertPhase(state, PHASES.CHOOSE_NEXT_ACTION);
    finishTurn(state, "voluntary_stop");
    return state;
  }

  function finishTurn(state, reason) {
    if (state.match.over) {
      return state;
    }

    state.resolution = null;

    if (
      reason === "three_slots" &&
      !state.turn.playedPin &&
      state.turn.slots.every((slot) => slot.countedForCombo)
    ) {
      transitionTo(state, PHASES.COMBO_CHECK);
      state.turn.comboAchieved = true;
      addLog(
        state,
        `${getCurrentAttacker(state).name} completes a combo. ${getCurrentDefender(state).name} gains 1 Fail card.`
      );
      addPinfallCards(state, state.turn.defenderKey, "Fail", 1, "combo");
    }

    state.turn.endedEarly = reason !== "three_slots";
    state.turn.endReason = reason;
    state.pendingTurnStart = {
      attackerKey: state.turn.defenderKey,
      number: state.turn.number + 1
    };

    transitionTo(state, PHASES.TURN_END);
    state.status = buildTurnEndMessage(state, reason);
    addLog(state, state.status);
    return state;
  }

  function continueAfterTurnEnd(state) {
    assertActiveMatch(state);
    assertPhase(state, PHASES.TURN_END);

    if (!state.pendingTurnStart) {
      throw new Error("No next turn is queued.");
    }

    const pending = state.pendingTurnStart;
    state.pendingTurnStart = null;
    startTurn(state, pending.attackerKey, pending.number);
    return state;
  }

  function buildTurnEndMessage(state, reason) {
    const attacker = getCurrentAttacker(state);

    if (reason === "successful_defence") {
      return `${attacker.name}'s turn ends early on a successful defence.`;
    }

    if (reason === "pin") {
      return `${attacker.name}'s turn ends after the pin sequence.`;
    }

    if (reason === "no_playable_offense") {
      return `${attacker.name}'s turn ends with no playable offense.`;
    }

    if (reason === "voluntary_stop") {
      return `${attacker.name} stops the offensive sequence early.`;
    }

    return `${attacker.name}'s turn ends after ${state.rules.maxSequenceSlots} ${pluralize("slot", state.rules.maxSequenceSlots)}.`;
  }

  function advanceAfterResolvedOffense(state) {
    if (state.turn.playsUsed >= state.rules.maxSequenceSlots) {
      finishTurn(state, "three_slots");
      return state;
    }

    transitionToChooseNextAction(state);
    return state;
  }

  function applyDamage(state, playerKey, amount) {
    const player = getPlayer(state, playerKey);
    const previousDamage = player.damage;
    const previousThresholds = player.failThresholdsReached;

    player.damage += amount;
    player.failThresholdsReached = Math.floor(player.damage / state.rules.damagePerFail);

    const failCardsAdded = player.failThresholdsReached - previousThresholds;

    if (failCardsAdded > 0) {
      addPinfallCards(state, playerKey, "Fail", failCardsAdded, "damage");
    }

    return {
      previousDamage,
      newDamage: player.damage,
      failCardsAdded
    };
  }

  function logDamageThresholds(state, playerKey, damageResult) {
    const player = getPlayer(state, playerKey);

    addLog(
      state,
      `${player.name}'s damage rises from ${damageResult.previousDamage} to ${damageResult.newDamage}.`
    );

    if (damageResult.failCardsAdded > 0) {
      addLog(
        state,
        `${player.name} crosses ${damageResult.failCardsAdded} damage ${pluralize("threshold", damageResult.failCardsAdded)} and gains ${damageResult.failCardsAdded} Fail ${pluralize("card", damageResult.failCardsAdded)}.`
      );
    }
  }

  function applyEffects(state, effects, ownerKey, opponentKey, sourceName) {
    (effects || []).forEach((effect) => {
      if (!effect || effect.type === "modify_damage") {
        return;
      }

      if (effect.type === "add_pinfall" || effect.type === "pinfall") {
        const targetKey = effect.target === "self" ? ownerKey : opponentKey;
        addPinfallCards(state, targetKey, effect.card, effect.amount || 1, sourceName);
      }
    });
  }

  function addPinfallCards(state, playerKey, cardType, amount, sourceName) {
    const player = getPlayer(state, playerKey);

    for (let index = 0; index < amount; index += 1) {
      player.pinfallDeck.push(cardType);
    }

    player.pinfallDeck = shuffleArray(player.pinfallDeck, state.meta.random);
    addLog(
      state,
      `${player.name} gains ${amount} ${cardType} ${pluralize("card", amount)}${sourceName ? ` from ${sourceName}` : ""}.`
    );
  }

  function moveCardAfterUse(state, playerKey, card) {
    const player = getPlayer(state, playerKey);
    const destination = card.afterUse === "exhaust" ? "exhaustPile" : "discardPile";
    player[destination].push(card);
    addLog(
      state,
      `${card.name} goes to ${destination === "exhaustPile" ? "exhaust" : "discard"}.`
    );
    return destination === "exhaustPile" ? "exhaust" : "discard";
  }

  function recordNoDefence(state) {
    const defender = getPlayer(state, state.resolution.defenderKey);
    updateSlotDefence(state, {
      actorKey: state.resolution.defenderKey,
      choice: "none",
      cardName: "",
      call: null,
      flips: [],
      success: null,
      coinMode: "normal"
    });

    addLog(state, `${defender.name} chooses no defence.`);
    state.resolution.awaitingDefenceChoice = false;
    state.resolution.awaitingCoinCall = false;
    state.resolution.defence = null;
  }

  function updateSlotDefence(state, defenceInfo) {
    const slotRecord = getTurnSlot(state, state.resolution.slot);
    slotRecord.defence = {
      actorKey: defenceInfo.actorKey,
      choice: defenceInfo.choice,
      cardName: defenceInfo.cardName,
      call: defenceInfo.call,
      flips: defenceInfo.flips,
      success: defenceInfo.success,
      coinMode: defenceInfo.coinMode
    };
  }

  function getTurnSlot(state, slotNumber) {
    const slotRecord = state.turn?.slots?.[slotNumber - 1];
    if (!slotRecord) {
      throw new Error(`Slot ${slotNumber} is not available.`);
    }

    return slotRecord;
  }

  function computeAttackDamage(card, onSlot) {
    if (onSlot && typeof card.onSlotDamage === "number") {
      return Math.max(0, card.onSlotDamage);
    }

    if (!onSlot && typeof card.offSlotDamage === "number") {
      return Math.max(0, card.offSlotDamage);
    }

    let damage = Number(card.damage || 0);
    const slotEffects = onSlot ? card.onSlotEffect : card.offSlotEffect;

    (slotEffects || []).forEach((effect) => {
      if (effect?.type === "modify_damage") {
        damage += Number(effect.amount || 0);
      }
    });

    return Math.max(0, damage);
  }

  function extractAfterDamageEffects(card, onSlot, kind) {
    const slotEffects = (onSlot ? card.onSlotEffect : card.offSlotEffect).filter((effect) => {
      return effect?.type !== "modify_damage";
    });

    if (kind === "attack") {
      return slotEffects.concat(card.onHitEffects || []);
    }

    return slotEffects;
  }

  function getDefenceCoinMode(resolution) {
    const override =
      resolution.card.defenceModifiers?.[
        resolution.kind === "pin" ? "pin" : resolution.onSlot ? "onSlot" : "offSlot"
      ];

    if (override) {
      return override;
    }

    if (resolution.kind === "attack" && resolution.onSlot === false) {
      return "advantage";
    }

    return "normal";
  }

  function flipCoins(state, count) {
    const flips = [];
    for (let index = 0; index < count; index += 1) {
      flips.push(nextCoinSide(state));
    }
    return flips;
  }

  function nextCoinSide(state) {
    return nextRandom(state) < 0.5 ? "Heads" : "Tails";
  }

  function evaluateCoinResult(flips, call, mode) {
    if (mode === "advantage") {
      return flips.some((flip) => flip === call);
    }

    if (mode === "disadvantage") {
      return flips.every((flip) => flip === call);
    }

    return flips[0] === call;
  }

  function chooseAiOffence(state, actorKey) {
    const activeActorKey = actorKey || state.turn.attackerKey;
    const slot = state.turn.nextSlot;
    const defender = getPlayer(state, getOpponentKey(activeActorKey));
    const offensiveEntries = getOffenseOptions(state, activeActorKey);

    if (offensiveEntries.length === 0) {
      return { type: "stop" };
    }

    const scored = offensiveEntries.map((entry) => {
      return {
        ...entry,
        score: scoreAiOffenseCard(state, entry.card, slot, defender)
      };
    });

    scored.sort((left, right) => right.score - left.score);
    return { type: "play", handIndex: scored[0].handIndex };
  }

  function scoreAiOffenseCard(state, card, slot, defender) {
    let score = nextRandom(state);
    const onSlot = card.type === "pin" ? true : doesCardMatchSlot(card, slot);
    const pinSummary = getPinfallSummary(defender);
    const pinPressure = pinSummary.total > 0 ? pinSummary.fail / pinSummary.total : 0;

    if (card.type === "attack") {
      score += 20 + (card.damage || 0) + (onSlot ? 4 : 1);
    }

    if (card.type === "taunt") {
      score += 10 + getPinfallEffectPressure(card.onSlotEffect) + (onSlot ? 3 : 0);
    }

    if (card.type === "pin") {
      score += defender.damage * 0.35 + pinPressure * 30 + (state.turn.playsUsed > 0 ? 3 : 0);
    }

    return score;
  }

  function getPinfallEffectPressure(effects) {
    return (effects || []).reduce((total, effect) => {
      if (effect?.type === "add_pinfall" || effect?.type === "pinfall") {
        return total + (effect.card === "Fail" ? effect.amount || 1 : 0);
      }

      return total;
    }, 0);
  }

  function chooseAiDefence(state) {
    if (!state.resolution || !state.resolution.awaitingDefenceChoice) {
      return { type: "none" };
    }

    const options = getDefenseOptions(state, state.resolution.defenderKey);
    if (options.length === 0) {
      return { type: "none" };
    }

    const threat =
      state.resolution.kind === "pin"
        ? 99
        : (state.resolution.card.damage || 0) + getPinfallEffectPressure(state.resolution.card.onHitEffects);
    let defendChance = state.resolution.kind === "pin" ? 0.9 : state.resolution.onSlot ? 0.55 : 0.75;

    if (threat <= 3) {
      defendChance -= 0.2;
    }

    if (nextRandom(state) > defendChance) {
      return { type: "none" };
    }

    const reversals = options.filter((entry) => entry.card.type === "reversal");
    const dodges = options.filter((entry) => entry.card.type === "dodge");
    const preferredPool =
      state.resolution.kind === "pin" && reversals.length > 0 && nextRandom(state) > 0.4
        ? reversals
        : dodges.length > 0
          ? dodges
          : reversals;
    const chosen = preferredPool[0] || options[0];

    return {
      type: "card",
      handIndex: chosen.handIndex
    };
  }

  function inspectAiOffence(state, actorKey) {
    const activeActorKey = actorKey || state.turn?.attackerKey;
    if (!activeActorKey || !state.turn) {
      return {
        type: "unavailable",
        reason: "No active turn is in progress."
      };
    }

    const slot = state.turn.nextSlot;
    const defender = getPlayer(state, getOpponentKey(activeActorKey));
    const offensiveEntries = getOffenseOptions(state, activeActorKey);
    const pinSummary = getPinfallSummary(defender);
    const pinPressure = pinSummary.total > 0 ? pinSummary.fail / pinSummary.total : 0;

    if (offensiveEntries.length === 0) {
      return {
        type: "stop",
        actorKey: activeActorKey,
        slot,
        reason: "No offensive cards are available in hand."
      };
    }

    const options = offensiveEntries
      .map((entry) => {
        return {
          handIndex: entry.handIndex,
          card: cloneCard(entry.card),
          ...buildAiOffenseCardInsight(state, entry.card, slot, pinPressure, defender)
        };
      })
      .sort((left, right) => {
        if (right.deterministicScore !== left.deterministicScore) {
          return right.deterministicScore - left.deterministicScore;
        }

        return left.handIndex - right.handIndex;
      });

    const top = options[0];
    const runnerUp = options[1];
    const certaintyGap = runnerUp ? top.deterministicScore - runnerUp.deterministicScore : Number.POSITIVE_INFINITY;

    return {
      type: "play",
      actorKey: activeActorKey,
      slot,
      pinPressure,
      certainty:
        certaintyGap > 1 ? "high" : certaintyGap > 0.35 ? "medium" : "low",
      choice: {
        handIndex: top.handIndex,
        card: cloneCard(top.card),
        explanation: top.explanation,
        scoreRange: top.scoreRange
      },
      options
    };
  }

  function buildAiOffenseCardInsight(state, card, slot, pinPressure, defender) {
    const breakdown = [];
    const onSlot = card.type === "pin" ? true : doesCardMatchSlot(card, slot);
    let deterministicScore = 0;

    if (card.type === "attack") {
      deterministicScore += 20;
      breakdown.push({ label: "Attack base", value: 20 });
      deterministicScore += Number(card.damage || 0);
      breakdown.push({ label: "Damage", value: Number(card.damage || 0) });
      deterministicScore += onSlot ? 4 : 1;
      breakdown.push({ label: onSlot ? "On-slot bonus" : "Off-slot fallback", value: onSlot ? 4 : 1 });
    }

    if (card.type === "taunt") {
      const pressure = getPinfallEffectPressure(card.onSlotEffect);
      deterministicScore += 10;
      breakdown.push({ label: "Taunt base", value: 10 });
      deterministicScore += pressure;
      breakdown.push({ label: "Pinfall pressure", value: pressure });
      if (onSlot) {
        deterministicScore += 3;
        breakdown.push({ label: "On-slot bonus", value: 3 });
      }
    }

    if (card.type === "pin") {
      const damageWeight = defender.damage * 0.35;
      const pressureWeight = pinPressure * 30;
      const sequenceBonus = state.turn.playsUsed > 0 ? 3 : 0;
      deterministicScore += damageWeight;
      deterministicScore += pressureWeight;
      deterministicScore += sequenceBonus;
      breakdown.push({ label: "Damage pressure", value: roundScore(damageWeight) });
      breakdown.push({ label: "Fail pressure", value: roundScore(pressureWeight) });
      if (sequenceBonus > 0) {
        breakdown.push({ label: "Late-sequence bonus", value: sequenceBonus });
      }
    }

    return {
      onSlot,
      deterministicScore: roundScore(deterministicScore),
      scoreRange: [roundScore(deterministicScore), roundScore(deterministicScore + 1)],
      breakdown,
      explanation: buildAiOffenseExplanation(card, onSlot, pinPressure, defender, state.turn.playsUsed)
    };
  }

  function buildAiOffenseExplanation(card, onSlot, pinPressure, defender, playsUsed) {
    if (card.type === "attack") {
      return onSlot
        ? `${card.name} is on-slot, so the AI gets full attack value plus the card's raw damage.`
        : `${card.name} is still legal off-slot, but it only gets a small placement bonus.`;
    }

    if (card.type === "taunt") {
      return onSlot
        ? `${card.name} is on-slot and pressures ${defender.name}'s pinfall deck immediately.`
        : `${card.name} is a lower-priority taunt here because its stronger effect only lands on-slot.`;
    }

    const failPercent = Math.round(pinPressure * 100);
    return `${card.name} gets stronger as ${defender.name} builds damage and a fail-heavy deck${playsUsed > 0 ? ", plus a small bonus for ending a sequence late" : ""}. Current fail pressure is ${failPercent}%.`;
  }

  function inspectAiDefence(state) {
    if (!state.resolution || !state.resolution.awaitingDefenceChoice) {
      return {
        type: "unavailable",
        reason: "No defence decision is waiting."
      };
    }

    const options = getDefenseOptions(state, state.resolution.defenderKey);
    const threat =
      state.resolution.kind === "pin"
        ? 99
        : (state.resolution.card.damage || 0) + getPinfallEffectPressure(state.resolution.card.onHitEffects);
    let defendChance = state.resolution.kind === "pin" ? 0.9 : state.resolution.onSlot ? 0.55 : 0.75;

    if (threat <= 3) {
      defendChance -= 0.2;
    }

    defendChance = Math.max(0, Math.min(defendChance, 1));

    if (options.length === 0) {
      return {
        type: "none",
        threat,
        defendChance,
        reason: "No dodge or reversal cards are available."
      };
    }

    const reversals = options.filter((entry) => entry.card.type === "reversal");
    const dodges = options.filter((entry) => entry.card.type === "dodge");
    const choiceWeights = {
      none: roundScore(1 - defendChance),
      dodge: 0,
      reversal: 0
    };

    if (defendChance > 0) {
      if (state.resolution.kind === "pin" && reversals.length > 0 && dodges.length > 0) {
        choiceWeights.reversal = roundScore(defendChance * 0.6);
        choiceWeights.dodge = roundScore(defendChance * 0.4);
      } else if (dodges.length > 0) {
        choiceWeights.dodge = roundScore(defendChance);
      } else if (reversals.length > 0) {
        choiceWeights.reversal = roundScore(defendChance);
      }
    }

    const rankedChoices = [
      {
        type: "none",
        probability: choiceWeights.none,
        handIndex: null,
        card: null
      }
    ];

    if (dodges[0]) {
      rankedChoices.push({
        type: "dodge",
        probability: choiceWeights.dodge,
        handIndex: dodges[0].handIndex,
        card: cloneCard(dodges[0].card)
      });
    }

    if (reversals[0]) {
      rankedChoices.push({
        type: "reversal",
        probability: choiceWeights.reversal,
        handIndex: reversals[0].handIndex,
        card: cloneCard(reversals[0].card)
      });
    }

    rankedChoices.sort((left, right) => right.probability - left.probability);

    return {
      type: "decision",
      defenderKey: state.resolution.defenderKey,
      threat,
      defendChance: roundScore(defendChance),
      coinMode: getDefenceCoinMode(state.resolution),
      defenceWinRate: roundScore(getDefenceWinRate(getDefenceCoinMode(state.resolution))),
      rationale: buildAiDefenceRationale(state.resolution, threat, defendChance, dodges, reversals),
      choices: rankedChoices
    };
  }

  function buildAiDefenceRationale(resolution, threat, defendChance, dodges, reversals) {
    const notes = [];

    if (resolution.kind === "pin") {
      notes.push("Pins get the highest urgency, so the AI almost always tries to defend.");
    } else if (resolution.onSlot === false) {
      notes.push("Off-slot attacks are easier to answer, so the defender is more willing to react.");
    } else {
      notes.push("On-slot attacks get a moderate defence rate unless the incoming damage is tiny.");
    }

    if (threat <= 3) {
      notes.push("Low-damage threats reduce the chance that the AI spends a defence card.");
    }

    if (resolution.kind === "pin" && dodges.length > 0 && reversals.length > 0) {
      notes.push("Against pins, reversals are preferred slightly more often than dodges.");
    } else if (dodges.length > 0) {
      notes.push("When not pinning, dodges are preferred before reversals if both are available.");
    }

    notes.push(`Current defend chance: ${Math.round(defendChance * 100)}%.`);
    return notes;
  }

  function getDefenceWinRate(mode) {
    let wins = 0;
    let losses = 0;

    for (let attackerRoll = 1; attackerRoll <= 20; attackerRoll += 1) {
      if (mode === "normal") {
        for (let defenderRoll = 1; defenderRoll <= 20; defenderRoll += 1) {
          if (defenderRoll > attackerRoll) {
            wins += 1;
          } else if (defenderRoll < attackerRoll) {
            losses += 1;
          }
        }
        continue;
      }

      for (let firstRoll = 1; firstRoll <= 20; firstRoll += 1) {
        for (let secondRoll = 1; secondRoll <= 20; secondRoll += 1) {
          const defenderRoll =
            mode === "advantage"
              ? Math.max(firstRoll, secondRoll)
              : Math.min(firstRoll, secondRoll);

          if (defenderRoll > attackerRoll) {
            wins += 1;
          } else if (defenderRoll < attackerRoll) {
            losses += 1;
          }
        }
      }
    }

    return wins + losses === 0 ? 0.5 : wins / (wins + losses);
  }

  function roundScore(value) {
    return Math.round(value * 100) / 100;
  }

  function getOffenseOptions(state, actorKey) {
    return getPlayer(state, actorKey).hand
      .map((card, handIndex) => {
        return { card, handIndex };
      })
      .filter((entry) => OFFENSIVE_TYPES.has(entry.card.type));
  }

  function getDefenseOptions(state, playerKey) {
    return getPlayer(state, playerKey).hand
      .map((card, handIndex) => {
        return { card, handIndex };
      })
      .filter((entry) => DEFENSIVE_TYPES.has(entry.card.type));
  }

  function hasPlayableOffense(state, actorKey) {
    return getOffenseOptions(state, actorKey).length > 0;
  }

  function doesCardMatchSlot(card, slotNumber) {
    if (card.validSlot === "any") {
      return true;
    }
    if (Array.isArray(card.slotOptions) && card.slotOptions.length > 0) {
      return card.slotOptions.includes(slotNumber);
    }
    return card.validSlot === slotNumber;
  }

  function normalizeCard(card) {
    const normalizedSlot = normalizeSlotDefinition(card);
    return {
      id: String(card.id),
      name: String(card.name),
      image: card.image ? String(card.image) : "",
      type: card.type,
      rarity: card.rarity || "common",
      category: card.category ? String(card.category) : card["// category"] ? String(card["// category"]) : "",
      effect: card.effect ? String(card.effect) : card["// effect"] ? String(card["// effect"]) : "",
      csvSlot: normalizedSlot.csvSlot,
      slotOptions: normalizedSlot.slotOptions,
      validSlot: normalizedSlot.validSlot,
      damage: Number(card.damage || 0),
      reverseDamage: Number(card.reverseDamage || 0),
      missDamage: Number(card.missDamage || 0),
      onSlotDamage: card.onSlotDamage === undefined ? undefined : Number(card.onSlotDamage),
      offSlotDamage: card.offSlotDamage === undefined ? undefined : Number(card.offSlotDamage),
      onSlotEffect: cloneEffects(card.onSlotEffect),
      offSlotEffect: cloneEffects(card.offSlotEffect),
      onHitEffects: cloneEffects(card.onHitEffects),
      onPinEffects: cloneEffects(card.onPinEffects),
      afterUse: card.afterUse === "exhaust" ? "exhaust" : "discard",
      defenceModifiers: cloneDefenceModifiers(card.defenceModifiers),
      flags: { ...(card.flags || {}) }
    };
  }

  function normalizeSlotDefinition(card) {
    const rawCsvSlot = card.csvSlot ?? card["// csvSlot"];
    const parsedCsvSlot = parseCsvSlot(rawCsvSlot);

    if (rawCsvSlot !== undefined && rawCsvSlot !== null) {
      if (parsedCsvSlot === "any") {
        return { csvSlot: String(rawCsvSlot), slotOptions: [], validSlot: "any" };
      }
      if (parsedCsvSlot.length > 0) {
        return {
          csvSlot: String(rawCsvSlot),
          slotOptions: parsedCsvSlot,
          validSlot: parsedCsvSlot.length === 1 ? parsedCsvSlot[0] : "multi"
        };
      }
    }

    const fallback = card.validSlot ?? card.slot ?? (card.type === "pin" ? "any" : null);
    if (fallback === "any") {
      return { csvSlot: "any", slotOptions: [], validSlot: "any" };
    }
    if (fallback === null || fallback === undefined) {
      return { csvSlot: null, slotOptions: [], validSlot: null };
    }

    const numericFallback = Number(fallback);
    if (Number.isFinite(numericFallback)) {
      return {
        csvSlot: String(numericFallback),
        slotOptions: [numericFallback],
        validSlot: numericFallback
      };
    }

    return { csvSlot: null, slotOptions: [], validSlot: null };
  }

  function parseCsvSlot(value) {
    const text = String(value || "").trim().toLowerCase();
    if (!text) {
      return [];
    }
    if (text === "any") {
      return "any";
    }

    const parts = text.split("/").map((part) => part.trim()).filter(Boolean);
    const slots = [];
    for (const part of parts) {
      const slot = Number(part);
      if (Number.isFinite(slot)) {
        slots.push(slot);
      }
    }
    return [...new Set(slots)];
  }

  function cloneCard(card) {
    return normalizeCard(card);
  }

  function cloneCardList(cards) {
    return (cards || []).map((card) => normalizeCard(card));
  }

  function cloneEffects(effects) {
    if (!Array.isArray(effects)) {
      return [];
    }

    return effects.map((effect) => ({ ...effect }));
  }

  function cloneDefenceModifiers(modifiers) {
    if (!modifiers) {
      return {};
    }

    return {
      onSlot: modifiers.onSlot,
      offSlot: modifiers.offSlot,
      pin: modifiers.pin
    };
  }

  function clonePinfallDeck(pinfallDeck, rules) {
    if (Array.isArray(pinfallDeck) && pinfallDeck.length > 0) {
      return [...pinfallDeck];
    }

    const deck = [];

    for (let index = 0; index < rules.startingPinFails; index += 1) {
      deck.push("Fail");
    }

    for (let index = 0; index < rules.startingPinKickouts; index += 1) {
      deck.push("Kickout");
    }

    return deck;
  }

  function getPinfallSummary(player) {
    let fail = 0;
    let kickout = 0;

    player.pinfallDeck.forEach((card) => {
      if (card === "Fail") {
        fail += 1;
        return;
      }

      if (card === "Kickout") {
        kickout += 1;
      }
    });

    return {
      total: player.pinfallDeck.length,
      fail,
      kickout
    };
  }

  function buildDeckForWrestler(wrestler, cardLookup, deckRecipe) {
    const deck = [];
    const cardList = Object.values(cardLookup || {});
    const wrestlerCategory = String(wrestler?.category || "").toLowerCase();

    deckRecipe.forEach((entry) => {
      if (entry.cardId) {
        const definition = cardLookup[entry.cardId];
        if (!definition) {
          throw new Error(`Unknown card id "${entry.cardId}" in deck recipe.`);
        }

        for (let index = 0; index < entry.count; index += 1) {
          deck.push(normalizeCard(definition));
        }
        return;
      }

      if (entry.type) {
        const generated = buildTypeBasedCardsForWrestler(
          wrestler,
          entry.type,
          Number(entry.count || 0),
          cardList,
          wrestlerCategory
        );
        generated.forEach((card) => deck.push(card));
        return;
      }

      throw new Error("Deck recipe entries must include cardId or type.");
    });

    return deck;
  }

  function buildTypeBasedCardsForWrestler(wrestler, type, count, cardList, wrestlerCategory) {
    if (count <= 0) {
      return [];
    }

    let candidates = cardList.filter((card) => card.type === type);
    let preferred = candidates;
    let fallback = [];
    if (type === "attack" && wrestlerCategory) {
      const categoryMatches = candidates.filter((card) => String(card.category || card["// category"] || "").toLowerCase() === wrestlerCategory);
      if (categoryMatches.length > 0) {
        preferred = categoryMatches;
        fallback = candidates.filter((card) => !categoryMatches.some((match) => match.id === card.id));
      }
    }

    if (candidates.length === 0) {
      throw new Error(`No cards found for recipe type "${type}".`);
    }

    const ordered = [
      ...sortCardsForWrestler(preferred, `${wrestler?.name || "wrestler"}:${type}:preferred`),
      ...sortCardsForWrestler(fallback, `${wrestler?.name || "wrestler"}:${type}:fallback`)
    ];
    const perCardCounts = {};
    const picked = [];
    let cursor = 0;
    let safety = 0;

    while (picked.length < count) {
      const definition = ordered[cursor % ordered.length];
      cursor += 1;
      safety += 1;
      if (safety > 3000) {
        throw new Error(`Unable to satisfy ${type} deck recipe for ${wrestler?.name || "wrestler"}.`);
      }

      const limit = RARITY_LIMITS[definition.rarity] || 1;
      const seen = perCardCounts[definition.id] || 0;
      if (seen >= limit) {
        continue;
      }

      perCardCounts[definition.id] = seen + 1;
      picked.push(normalizeCard(definition));
    }

    return picked;
  }

  function sortCardsForWrestler(cards, seedText) {
    return [...cards].sort((left, right) => {
      const leftScore = hashString(`${seedText}:${left.id}`);
      const rightScore = hashString(`${seedText}:${right.id}`);
      if (leftScore !== rightScore) {
        return leftScore - rightScore;
      }
      return String(left.id).localeCompare(String(right.id));
    });
  }

  function hashString(value) {
    let hash = 2166136261;
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function getCurrentAttacker(state) {
    return getPlayer(state, state.turn.attackerKey);
  }

  function getCurrentDefender(state) {
    return getPlayer(state, state.turn.defenderKey);
  }

  function getPlayer(state, key) {
    return state.players[key];
  }

  function getOpponentKey(key) {
    return key === "player" ? "enemy" : "player";
  }

  function transitionTo(state, phase) {
    state.phase = phase;
    state.phaseHistory.push(phase);
  }

  function addLog(state, message) {
    if (!message) {
      return;
    }

    state.log.push(message);
    state.log.push(`LOG_STATE ${JSON.stringify(buildLogStateSnapshot(state, message))}`);
  }

  function buildLogStateSnapshot(state, message) {
    return {
      event: message,
      phase: state.phase,
      turn: state.turn ? state.turn.number : null,
      rules: buildRules(state.rules),
      wrestlers: {
        player: buildWrestlerLogState(state.players.player),
        enemy: buildWrestlerLogState(state.players.enemy)
      }
    };
  }

  function buildWrestlerLogState(player) {
    const summary = summarizePinfallDeck(player.pinfallDeck);
    return {
      name: player.name,
      hand: player.hand.map((card) => card.name),
      pinfall: {
        fail: summary.fail,
        kickout: summary.kickout,
        total: player.pinfallDeck.length
      }
    };
  }

  function summarizePinfallDeck(pinfallDeck) {
    return pinfallDeck.reduce(
      (accumulator, entry) => {
        const value = String(entry || "").toLowerCase();
        if (value.startsWith("fail")) {
          accumulator.fail += 1;
        } else if (value.startsWith("kickout")) {
          accumulator.kickout += 1;
        }
        return accumulator;
      },
      { fail: 0, kickout: 0 }
    );
  }

  function shuffleArray(items, random) {
    const clone = [...items];

    for (let index = clone.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      const previous = clone[index];
      clone[index] = clone[swapIndex];
      clone[swapIndex] = previous;
    }

    return clone;
  }

  function createRandomSource(input) {
    if (typeof input === "function") {
      return input;
    }

    if (Array.isArray(input)) {
      let index = 0;
      return function nextQueuedValue() {
        const value = input[index];
        index += 1;
        return value === undefined ? 0 : value;
      };
    }

    return function fallbackRandom() {
      return Math.random();
    };
  }

  function nextRandom(state) {
    return state.meta.random();
  }

  function formatSlotStatus(onSlot) {
    if (onSlot === null) {
      return "";
    }

    return onSlot ? " on-slot" : " off-slot";
  }

  function buildCoinModeDescription(mode) {
    if (mode === "advantage") {
      return "Defender rolls 2d20 and keeps the higher roll.";
    }

    if (mode === "disadvantage") {
      return "Defender rolls 2d20 and keeps the lower roll.";
    }

    return "Both players roll 1d20. Highest roll wins.";
  }

  function rollD20(state) {
    return Math.max(1, Math.min(20, Math.floor(nextRandom(state) * 20) + 1));
  }

  function pluralize(word, count) {
    return count === 1 ? word : `${word}s`;
  }

  function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function endMatch(state, winnerKey, reason) {
    state.resolution = null;
    state.pinAttempt = null;
    state.pendingTurnStart = null;
    transitionTo(state, PHASES.MATCH_END);
    state.match.over = true;
    state.match.winnerKey = winnerKey;
    state.match.loserKey = getOpponentKey(winnerKey);
    state.match.reason = reason;
    state.status = reason;
    state.outcome = winnerKey === "player" ? "You win." : "You lose.";
    addLog(state, reason);
  }

  function assertActiveMatch(state) {
    if (state.match.over) {
      throw new Error("The match is already over.");
    }
  }

  function assertPhase(state, phase) {
    if (state.phase !== phase) {
      throw new Error(`Expected phase ${phase} but found ${state.phase}.`);
    }
  }

  function assertAwaitingDefenceChoice(state) {
    if (!state.resolution || !state.resolution.awaitingDefenceChoice) {
      throw new Error("There is no defence decision waiting.");
    }
  }

  return {
    COIN_SIDES,
    DEFENSIVE_TYPES,
    OFFENSIVE_TYPES,
    PHASES,
    buildRules,
    constants: {
      HAND_SIZE,
      MAX_SEQUENCE_SLOTS,
      DAMAGE_PER_FAIL,
      PIN_DRAW_COUNT,
      STARTING_PIN_FAILS,
      STARTING_PIN_KICKOUTS
    },
    addPinfallCards,
    buildDeckForWrestler,
    callDefenceCoin,
    chooseAiDefence,
    chooseAiOffence,
    chooseNoDefence,
    continueAfterTurnEnd,
    createMatch,
    doesCardMatchSlot,
    drawNextPinfallCard,
    getCurrentAttacker,
    getCurrentDefender,
    getDefenseOptions,
    getDefenceWinRate,
    getOffenseOptions,
    getOpponentKey,
    getPinfallSummary,
    hydrateMatchState,
    hasPlayableOffense,
    inspectAiDefence,
    inspectAiOffence,
    normalizeCard,
    playOffensiveCard,
    prepareDefence,
    serializeMatchState,
    stopTurn,
    updateRules
  };
});
