(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }

  root.UnderCardDebugShared = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const SESSION_STORAGE_KEY = "undercard.debug.session.v1";
  const SESSION_VERSION = 1;
  const RULE_DEFAULTS = Object.freeze({
    handSize: 6,
    maxSequenceSlots: 3,
    damagePerFail: 10,
    pinDrawCount: 3,
    startingPinFails: 3,
    startingPinKickouts: 7
  });
  const RARITY_LIMIT_DEFAULTS = Object.freeze({
    common: 4,
    uncommon: 3,
    rare: 2,
    special: 2
  });

  function createDefaultSettings(overrides) {
    const next = overrides || {};
    return {
      rules: normalizeRules(next.rules),
      playerTemplateName: typeof next.playerTemplateName === "string" ? next.playerTemplateName : "",
      enemyTemplateName: typeof next.enemyTemplateName === "string" ? next.enemyTemplateName : "",
      initiativeWinner: next.initiativeWinner === "player" || next.initiativeWinner === "enemy" ? next.initiativeWinner : "",
      shuffleManeuverDeck: next.shuffleManeuverDeck === undefined ? true : Boolean(next.shuffleManeuverDeck),
      aiStepDelay: normalizeWholeNumber(next.aiStepDelay, 1000, 0),
      rarityLimits: normalizeRarityLimits(next.rarityLimits)
    };
  }

  function mergeSettings(base, updates) {
    const baseSettings = createDefaultSettings(base);
    const next = updates || {};

    return createDefaultSettings({
      ...baseSettings,
      ...next,
      rules: {
        ...baseSettings.rules,
        ...(next.rules || {})
      },
      rarityLimits: {
        ...baseSettings.rarityLimits,
        ...(next.rarityLimits || {})
      }
    });
  }

  function normalizeRules(rules) {
    return {
      handSize: normalizeWholeNumber(rules?.handSize, RULE_DEFAULTS.handSize, 1),
      maxSequenceSlots: normalizeWholeNumber(rules?.maxSequenceSlots, RULE_DEFAULTS.maxSequenceSlots, 1),
      damagePerFail: normalizeWholeNumber(rules?.damagePerFail, RULE_DEFAULTS.damagePerFail, 1),
      pinDrawCount: normalizeWholeNumber(rules?.pinDrawCount, RULE_DEFAULTS.pinDrawCount, 1),
      startingPinFails: normalizeWholeNumber(rules?.startingPinFails, RULE_DEFAULTS.startingPinFails, 0),
      startingPinKickouts: normalizeWholeNumber(rules?.startingPinKickouts, RULE_DEFAULTS.startingPinKickouts, 0)
    };
  }

  function normalizeRarityLimits(limits) {
    return {
      common: normalizeWholeNumber(limits?.common, RARITY_LIMIT_DEFAULTS.common, 1),
      uncommon: normalizeWholeNumber(limits?.uncommon, RARITY_LIMIT_DEFAULTS.uncommon, 1),
      rare: normalizeWholeNumber(limits?.rare, RARITY_LIMIT_DEFAULTS.rare, 1),
      special: normalizeWholeNumber(limits?.special, RARITY_LIMIT_DEFAULTS.special, 1)
    };
  }

  function normalizeWholeNumber(value, fallback, minimum) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }

    return Math.max(minimum, Math.floor(numeric));
  }

  function createSourceId(prefix) {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function buildSession(payload) {
    return {
      version: SESSION_VERSION,
      updatedAt: Date.now(),
      sourceId: payload?.sourceId || createSourceId("debug"),
      settings: createDefaultSettings(payload?.settings),
      state: payload?.state || null
    };
  }

  function readSession(storage) {
    const targetStorage = storage || getStorage();
    if (!targetStorage) {
      return null;
    }

    try {
      const raw = targetStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== SESSION_VERSION) {
        return null;
      }

      return {
        version: SESSION_VERSION,
        updatedAt: Number(parsed.updatedAt || 0),
        sourceId: parsed.sourceId || "",
        settings: createDefaultSettings(parsed.settings),
        state: parsed.state || null
      };
    } catch (error) {
      return null;
    }
  }

  function writeSession(session, storage) {
    const targetStorage = storage || getStorage();
    if (!targetStorage) {
      return session;
    }

    targetStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    return session;
  }

  function clearSession(storage) {
    const targetStorage = storage || getStorage();
    if (!targetStorage) {
      return;
    }

    targetStorage.removeItem(SESSION_STORAGE_KEY);
  }

  function getStorage() {
    try {
      if (typeof localStorage === "undefined") {
        return null;
      }

      return localStorage;
    } catch (error) {
      return null;
    }
  }

  return {
    RARITY_LIMIT_DEFAULTS,
    RULE_DEFAULTS,
    SESSION_STORAGE_KEY,
    SESSION_VERSION,
    buildSession,
    clearSession,
    createDefaultSettings,
    createSourceId,
    mergeSettings,
    readSession,
    writeSession
  };
});
