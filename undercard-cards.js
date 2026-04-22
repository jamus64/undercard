(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }

  root.UndercardCards = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function parseCsv(text) {
    const rows = [];
    let currentRow = [];
    let currentCell = "";
    let inQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      const nextCharacter = text[index + 1];

      if (character === '"') {
        if (inQuotes && nextCharacter === '"') {
          currentCell += '"';
          index += 1;
          continue;
        }

        inQuotes = !inQuotes;
        continue;
      }

      if (character === "," && !inQuotes) {
        currentRow.push(currentCell);
        currentCell = "";
        continue;
      }

      if ((character === "\n" || character === "\r") && !inQuotes) {
        if (character === "\r" && nextCharacter === "\n") {
          index += 1;
        }

        currentRow.push(currentCell);
        currentCell = "";

        if (currentRow.some((cell) => String(cell || "").trim().length > 0)) {
          rows.push(currentRow);
        }

        currentRow = [];
        continue;
      }

      currentCell += character;
    }

    if (currentCell.length > 0 || currentRow.length > 0) {
      currentRow.push(currentCell);
      if (currentRow.some((cell) => String(cell || "").trim().length > 0)) {
        rows.push(currentRow);
      }
    }

    return rows;
  }

  function buildCardCatalogFromCsv(text) {
    const rows = parseCsv(text);
    const headerIndex = rows.findIndex((row) => normalizeCell(row[1]) === "card name");

    if (headerIndex === -1) {
      throw new Error("Could not find the card CSV header row.");
    }

    const dataRows = rows.slice(headerIndex + 1);
    return dataRows.map(buildCardFromRow);
  }

  function buildSharedDeckRecipe(cardPool) {
    return cardPool.map((card) => {
      return {
        cardId: card.id,
        count: 1
      };
    });
  }

  function buildCardFromRow(row) {
    const name = String(row[1] || "").trim();
    const csvType = String(row[2] || "").trim().toUpperCase();

    if (!name || !csvType) {
      throw new Error(`Invalid card row: ${JSON.stringify(row)}`);
    }

    const normalizedType = mapCardType(name, csvType);
    const baseCard = {
      id: slugify(name),
      name,
      type: normalizedType,
      validSlot: normalizedType === "pin" ? "any" : parseSlotValue(row[3]),
      damage: parseNumber(row[4]),
      reversalDamage: parseNumber(row[5]),
      missDamage: parseNumber(row[6]),
      afterUse: "discard",
      effectText: String(row[7] || "").trim(),
      onSlotEffect: [],
      offSlotEffect: [],
      onHitEffects: [],
      onPinEffects: [],
      onDodgedEffects: [],
      onDefendedEffects: [],
      contestModifiers: [],
      valueModifiers: [],
      immediatePin: false,
      flags: {}
    };

    return applyCardSpecificRules(baseCard);
  }

  function applyCardSpecificRules(card) {
    switch (card.name) {
      case "Eye Rake":
        card.onHitEffects.push({
          type: "roll_off",
          label: "Eye Rake",
          onLoseEffects: [{ type: "discard_random", target: "self", amount: 1 }]
        });
        break;
      case "Low Blow":
        card.onHitEffects.push({
          type: "roll_off",
          label: "Low Blow",
          onLoseEffects: [{ type: "add_pinfall", target: "self", card: "Fail", amount: 1 }]
        });
        break;
      case "Chair Shot":
        card.onHitEffects.push({
          type: "roll_off",
          label: "Chair Shot",
          onWinEffects: [{ type: "add_pinfall", target: "self", card: "Kickout", amount: 1 }],
          onLoseEffects: [{ type: "add_pinfall", target: "self", card: "Fail", amount: 2 }]
        });
        break;
      case "Sharpshooter":
        card.onHitEffects.push({
          type: "roll_off",
          label: "Sharpshooter",
          onWinEffects: [{ type: "discard_forced", target: "opponent", amount: 1 }]
        });
        break;
      case "Headbutt":
        card.onHitEffects.push({ type: "apply_damage", target: "self", amount: 3 });
        break;
      case "Clothesline":
        card.contestModifiers.push({
          when: { slot: 1 },
          target: "attacker",
          delta: -1
        });
        break;
      case "Spear":
      case "Shooting Star Press":
      case "Chokeslam":
      case "Super Kick":
        card.immediatePin = true;
        break;
      case "Cheap Shot":
        card.onHitEffects.push({ type: "discard_forced", target: "opponent", amount: 1 });
        break;
      case "Ref Distraction":
        card.onHitEffects.push({ type: "grant_next_rolloff_auto_win", amount: 1 });
        card.flags.replacementRule =
          "Replacement rule: the next offensive card you play this turn that causes a roll-off cannot lose that roll-off.";
        break;
      case "Elbow Drop":
      case "Frog Splash":
        card.contestModifiers.push({
          when: { previousCardType: "taunt" },
          target: "defender",
          delta: -1
        });
        break;
      case "450 Splash":
        card.onHitEffects.push({ type: "add_pinfall", target: "opponent", card: "Fail", amount: 1 });
        card.onDodgedEffects.push({ type: "discard_random", target: "self", amount: 1 });
        break;
      case "Second Rope Elbow Drop":
        card.contestModifiers.push({
          when: { slot: 3 },
          target: "defender",
          delta: -1
        });
        break;
      case "German Suplex":
      case "Powerbomb":
        card.onHitEffects.push({ type: "add_pinfall", target: "opponent", card: "Fail", amount: 1 });
        break;
      case "Bear Hug":
      case "Armbar":
        card.onHitEffects.push({
          type: "roll_off",
          label: card.name,
          onWinEffects: [{ type: "add_pinfall", target: "self", card: "Kickout", amount: 1 }]
        });
        break;
      case "Dropkick":
        card.valueModifiers.push({
          when: { slot: 3 },
          attack: 2
        });
        break;
      case "Body Blow":
      case "Chop":
        card.onHitEffects.push({ type: "draw_cards", target: "self", amount: 1 });
        break;
      case "Jab":
        card.onHitEffects.push({ type: "add_next_attack_bonus", amount: 1 });
        break;
      case "Irish Whip":
        card.onHitEffects.push({ type: "add_next_attack_bonus", amount: 2 });
        break;
      case "Trip":
        card.onHitEffects.push({ type: "discard_random", target: "opponent", amount: 1 });
        break;
      case "Figure Four Leg Lock":
        card.onHitEffects.push({
          type: "repeat_roll_off",
          count: 3,
          label: "Figure Four Leg Lock",
          onWinEffects: [{ type: "add_pinfall", target: "opponent", card: "Fail", amount: 1 }]
        });
        break;
      case "Gun Show":
        card.onSlotEffect.push({
          type: "roll_off",
          label: "Gun Show",
          onWinEffects: [{ type: "add_next_attack_bonus", amount: 1 }],
          onLoseEffects: [{ type: "draw_cards", target: "opponent", amount: 1 }]
        });
        break;
      case "Roar":
        card.onSlotEffect.push({ type: "add_next_attack_bonus", amount: 2 });
        break;
      case "Hulk Up":
        card.onSlotEffect.push({
          type: "add_slot_bonus",
          slots: [2, 3],
          attack: 2,
          reversal: 2,
          miss: 2
        });
        break;
      case "Fwahhh!":
      case "Yell at Crowd":
        card.onSlotEffect.push({ type: "discard_random", target: "self", amount: 1 });
        card.onSlotEffect.push({ type: "discard_random", target: "opponent", amount: 1 });
        break;
      case "Gyrate Hips":
        card.onSlotEffect.push({
          type: "add_pinfall_per_slot",
          target: "self",
          card: "Kickout"
        });
        break;
      case "Strut":
        card.onSlotEffect.push({ type: "add_pinfall", target: "self", card: "Kickout", amount: 1 });
        break;
      case "Shush":
        card.onSlotEffect.push({ type: "add_next_attack_bonus", amount: 1 });
        break;
      case "Air Guitar":
        card.onSlotEffect.push({ type: "draw_cards", target: "self", amount: 1 });
        card.onSlotEffect.push({ type: "discard_random", target: "self", amount: 1 });
        break;
      case "Complain to Ref":
        card.onSlotEffect.push({
          type: "roll_off",
          label: "Complain to Ref",
          onWinEffects: [{ type: "add_pinfall", target: "self", card: "Kickout", amount: 1 }],
          onLoseEffects: [{ type: "add_pinfall", target: "self", card: "Fail", amount: 2 }]
        });
        break;
      default:
        break;
    }

    if (card.type === "taunt" && card.offSlotEffect.length === 0) {
      card.offSlotEffect = [];
    }

    return card;
  }

  function mapCardType(name, csvType) {
    if (csvType === "ATK") {
      return "attack";
    }

    if (csvType === "TAUNT") {
      return "taunt";
    }

    if (csvType === "PIN") {
      return "pin";
    }

    if (csvType === "DEF") {
      if (name === "Dodge") {
        return "dodge";
      }

      return "reversal";
    }

    throw new Error(`Unsupported card type "${csvType}" for ${name}.`);
  }

  function parseSlotValue(value) {
    const normalized = String(value || "")
      .replace(/\s+/g, "")
      .trim();

    if (!normalized) {
      return null;
    }

    if (normalized === "1/2/3") {
      return [1, 2, 3];
    }

    return normalized.split("/").map((part) => Number(part));
  }

  function parseNumber(value) {
    const normalized = String(value || "").trim();
    if (!normalized || normalized.toUpperCase() === "#N/A") {
      return 0;
    }

    return Number(normalized);
  }

  function slugify(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function normalizeCell(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  return {
    buildCardCatalogFromCsv,
    buildSharedDeckRecipe,
    parseCsv
  };
});
