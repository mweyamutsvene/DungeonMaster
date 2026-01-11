export interface SpeedMode {
  type: "walk" | "fly" | "swim" | "climb" | "burrow" | "other";
  feet: number;
  raw: string;
}

export interface AbilityScoreBlock {
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
}

export interface ParsedMonsterAttack {
  name: string;
  kind: "melee" | "ranged" | "melee-or-ranged";
  attackBonus: number;
  reachFeet?: number;
  rangeFeet?: { normal: number; long?: number };
  damage?: {
    diceCount: number;
    diceSides: number;
    modifier: number;
    average?: number;
    type?: string;
    raw: string;
  };
  raw: string;
}

export interface ParsedMonsterAbility {
  name: string;
  section: "traits" | "actions" | "bonus-actions" | "reactions" | "legendary-actions";
  text: string;
  attack?: ParsedMonsterAttack;
  raw: string;
}

export interface ParsedMonsterStatBlock {
  name: string;
  size: string;
  kind: string;
  alignment?: string;

  armorClass: number;
  initiativeModifier?: number;

  hitPointsMax: number;
  hitPointsFormula?: string;

  speed: {
    baseFeet: number;
    modes: SpeedMode[];
    raw: string;
  };

  abilityScores: AbilityScoreBlock;

  challengeRating?: number;
  proficiencyBonus?: number;

  skillsRaw?: string;
  sensesRaw?: string;
  languagesRaw?: string;
  gear?: string[];

  traits: ParsedMonsterAbility[];
  actions: ParsedMonsterAbility[];
  bonusActions: ParsedMonsterAbility[];
  reactions: ParsedMonsterAbility[];
  legendaryActions: ParsedMonsterAbility[];

  attacks: ParsedMonsterAttack[];

  sourceMarkdown: string;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

function parseCr(text: string): number | undefined {
  const t = text.trim();
  if (!t) return undefined;

  // Supports "1/4" and "10".
  const fraction = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    const a = Number.parseInt(fraction[1]!, 10);
    const b = Number.parseInt(fraction[2]!, 10);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return undefined;
    return a / b;
  }

  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : undefined;
}

function parseSpeedModes(raw: string): { baseFeet: number; modes: SpeedMode[] } {
  // Example: "10 ft., Fly 90 ft. (hover)" or "30 ft." or "10 ft., Swim 40 ft."
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const modes: SpeedMode[] = [];

  for (const part of parts) {
    const m = part.match(/^(?:(Walk|Fly|Swim|Climb|Burrow)\s+)?(\d+)\s*ft\.?/i);
    if (!m) continue;

    const label = (m[1] ?? "Walk").toLowerCase();
    const feet = Number.parseInt(m[2]!, 10);

    const type: SpeedMode["type"] =
      label === "walk"
        ? "walk"
        : label === "fly"
          ? "fly"
          : label === "swim"
            ? "swim"
            : label === "climb"
              ? "climb"
              : label === "burrow"
                ? "burrow"
                : "other";

    if (Number.isFinite(feet)) {
      modes.push({ type, feet, raw: part });
    }
  }

  const walk = modes.find((x) => x.type === "walk");
  return { baseFeet: walk?.feet ?? 0, modes };
}

function parseAbilityScoreTableRow(line: string): { ability: keyof AbilityScoreBlock; score: number } | null {
  const m = line.match(/^\|\s*(Str|Dex|Con|Int|Wis|Cha)\s*\|\s*(\d+)\s*\|/i);
  if (!m) return null;

  const abbrev = m[1]!.toLowerCase();
  const score = Number.parseInt(m[2]!, 10);
  if (!Number.isFinite(score)) return null;

  const ability: keyof AbilityScoreBlock =
    abbrev === "str"
      ? "strength"
      : abbrev === "dex"
        ? "dexterity"
        : abbrev === "con"
          ? "constitution"
          : abbrev === "int"
            ? "intelligence"
            : abbrev === "wis"
              ? "wisdom"
              : "charisma";

  return { ability, score };
}

function extractInlineField(block: string, label: string): string | undefined {
  const re = new RegExp(`^\\s*(?:\\*\\*)?${escapeRegex(label)}(?:\\*\\*)?\\s+(.+?)\\s*$`, "mi");
  const m = block.match(re);
  return m?.[1]?.trim();
}

function extractSection(block: string, header: string): string {
  const allHeaders = [
    "Traits",
    "Actions",
    "Bonus Actions",
    "Reactions",
    "Legendary Actions",
    "Lair Actions",
    "Mythic Actions",
  ];

  const startRe = new RegExp(`^\\s*(?:\\*\\*)?${escapeRegex(header)}(?:\\*\\*)?\\s*$`, "mi");
  const startMatch = block.match(startRe);
  if (!startMatch || startMatch.index === undefined) return "";

  const startIdx = startMatch.index + startMatch[0].length;
  const after = block.slice(startIdx);

  const others = allHeaders.filter((h) => h.toLowerCase() !== header.toLowerCase());
  const endRe = new RegExp(
    `^\\s*(?:\\*\\*)?(?:${others.map((h) => escapeRegex(h)).join("|")})(?:\\*\\*)?\\s*$`,
    "mi",
  );
  const endMatch = after.match(endRe);
  const endIdx = endMatch && endMatch.index !== undefined ? endMatch.index : -1;

  return (endIdx === -1 ? after : after.slice(0, endIdx)).trim();
}

function parseNamedEntries(sectionText: string): Array<{ name: string; text: string; raw: string }> {
  const text = sectionText.trim();
  if (!text) return [];

  // Handles both:
  //   ***Name.*** text...
  // and:
  //   Name. text...
  const re = /(?:^|\n)\s*(?:\*\*\*)?([^\n\*]+?)\.(?:\*\*\*)?\s*/g;
  const matches = Array.from(text.matchAll(re));
  if (matches.length === 0) return [];

  const entries: Array<{ name: string; text: string; raw: string }> = [];

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const start = m.index ?? 0;
    const bodyStart = start + m[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1]!.index ?? text.length) : text.length;

    const name = (m[1] ?? "").trim();
    const body = text.slice(bodyStart, end).trim();
    const raw = text.slice(start, end).trim();
    if (!name) continue;

    entries.push({ name, text: body, raw });
  }

  return entries;
}

function parseAttackFromEntry(entry: { name: string; text: string; raw: string }): ParsedMonsterAttack | undefined {
  const body = entry.text;
  const attackRoll = body.match(
    /(?:\*+)?(Melee|Ranged|Melee or Ranged)\s+Attack Roll:(?:\*+)?\s*\+?(-?\d+)/i,
  );
  if (!attackRoll) return undefined;

  const kindRaw = attackRoll[1]!.toLowerCase();
  const kind: ParsedMonsterAttack["kind"] =
    kindRaw === "melee" ? "melee" : kindRaw === "ranged" ? "ranged" : "melee-or-ranged";

  const attackBonus = Number.parseInt(attackRoll[2]!, 10);

  const reach = body.match(/reach\s+(\d+)\s*ft\.?/i);
  const reachFeet = reach ? Number.parseInt(reach[1]!, 10) : undefined;

  const range = body.match(/range\s+(\d+)\s*ft\.?\s*(?:\/\s*(\d+)\s*ft\.?)?/i);
  const rangeFeet = range
    ? {
        normal: Number.parseInt(range[1]!, 10),
        long: range[2] ? Number.parseInt(range[2], 10) : undefined,
      }
    : undefined;

  const hit = body.match(/(?:\*+)?Hit:(?:\*+)?\s*(\d+)\s*\((\d+)d(\d+)\s*([+-]\s*\d+)?\)\s*([^\n\.]+)?/i);
  const damage = hit
    ? {
        average: Number.parseInt(hit[1]!, 10),
        diceCount: Number.parseInt(hit[2]!, 10),
        diceSides: Number.parseInt(hit[3]!, 10),
        modifier: hit[4] ? Number.parseInt(hit[4].replace(/\s+/g, ""), 10) : 0,
        type: hit[5]?.trim(),
        raw: hit[0],
      }
    : undefined;

  return {
    name: entry.name,
    kind,
    attackBonus,
    reachFeet,
    rangeFeet,
    damage,
    raw: entry.raw,
  };
}

function parseAbilitiesFromSection(
  section: ParsedMonsterAbility["section"],
  sectionText: string,
): { abilities: ParsedMonsterAbility[]; attacks: ParsedMonsterAttack[] } {
  const entries = parseNamedEntries(sectionText);
  const abilities: ParsedMonsterAbility[] = [];
  const attacks: ParsedMonsterAttack[] = [];

  for (const entry of entries) {
    const attack = parseAttackFromEntry(entry);
    if (attack) attacks.push(attack);

    abilities.push({
      name: entry.name,
      section,
      text: entry.text,
      attack,
      raw: entry.raw,
    });
  }

  return { abilities, attacks };
}

export function parseCreatureStatBlocksMarkdown(markdown: string): {
  monsters: ParsedMonsterStatBlock[];
} {
  const lines = markdown.split(/\r?\n/);

  const headingRegex = /^(#{3,4})\s+(.+?)\s*$/;
  const headings: Array<{ level: number; name: string; lineIndex: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]?.match(headingRegex);
    if (!m) continue;
    const level = m[1]!.length;
    headings.push({ level, name: m[2]!.trim(), lineIndex: i });
  }

  const monsters: ParsedMonsterStatBlock[] = [];

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]!;
    const start = h.lineIndex;
    const end = i + 1 < headings.length ? headings[i + 1]!.lineIndex : lines.length;
    const block = lines.slice(start, end).join("\n").trim();

    // Skip category headings like "### Animated Objects" that don't contain a stat block.
    if (!block.includes("**AC**") || !block.includes("**HP**") || !block.includes("**Speed**")) {
      continue;
    }

    const name = h.name;

    const afterHeadingLines = lines
      .slice(start + 1, end)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const typeLine = afterHeadingLines[0] ?? "";
    const typeMatch = typeLine.match(/^(\w+)\s+([^,]+)(?:,\s*(.+))?$/);
    if (!typeMatch) {
      continue;
    }

    const size = typeMatch[1]!.trim();
    const kind = typeMatch[2]!.trim();
    const alignment = typeMatch[3]?.trim();

    const acMatch = block.match(/\*\*AC\*\*\s+(\d+)/);
    const hpMatch = block.match(/\*\*HP\*\*\s+(\d+)(?:\s*\(([^\)]+)\))?/);
    const speedMatch = block.match(/\*\*Speed\*\*\s+([^\n]+)/);

    if (!acMatch || !hpMatch || !speedMatch) {
      continue;
    }

    const armorClass = Number.parseInt(acMatch[1]!, 10);
    const hitPointsMax = Number.parseInt(hpMatch[1]!, 10);
    const hitPointsFormula = hpMatch[2]?.trim();

    const initiativeMatch = block.match(/\*\*Initiative\*\*\s*([+\-−]\s*\d+)/);
    const initiativeModifier = initiativeMatch
      ? Number.parseInt(initiativeMatch[1]!.replace(/\s+/g, "").replace("−", "-"), 10)
      : undefined;

    const speedRaw = speedMatch[1]!.trim();
    const parsedSpeed = parseSpeedModes(speedRaw);

    const abilityScores: Partial<AbilityScoreBlock> = {};
    for (const line of lines.slice(start, end)) {
      const row = parseAbilityScoreTableRow(line);
      if (!row) continue;
      abilityScores[row.ability] = row.score;
    }

    const complete: AbilityScoreBlock | null =
      typeof abilityScores.strength === "number" &&
      typeof abilityScores.dexterity === "number" &&
      typeof abilityScores.constitution === "number" &&
      typeof abilityScores.intelligence === "number" &&
      typeof abilityScores.wisdom === "number" &&
      typeof abilityScores.charisma === "number"
        ? (abilityScores as AbilityScoreBlock)
        : null;

    if (!complete) {
      continue;
    }

    const crLine = block.match(/\*\*CR\*\*\s+([^\s]+)(?:\s*\(|\s*$)/);
    const challengeRating = crLine ? parseCr(crLine[1]!) : undefined;

    const pbMatch = block.match(/PB\s*\+\s*(\d+)/i);
    const proficiencyBonus = pbMatch ? Number.parseInt(pbMatch[1]!, 10) : undefined;

    const skillsRaw = extractInlineField(block, "Skills");
    const sensesRaw = extractInlineField(block, "Senses");
    const languagesRaw = extractInlineField(block, "Languages");
    const gearRaw = extractInlineField(block, "Gear");
    const gear = gearRaw
      ? gearRaw
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      : undefined;

    const traitsSection = extractSection(block, "Traits");
    const actionsSection = extractSection(block, "Actions");
    const bonusActionsSection = extractSection(block, "Bonus Actions");
    const reactionsSection = extractSection(block, "Reactions");
    const legendaryActionsSection = extractSection(block, "Legendary Actions");

    const parsedTraits = parseAbilitiesFromSection("traits", traitsSection);
    const parsedActions = parseAbilitiesFromSection("actions", actionsSection);
    const parsedBonus = parseAbilitiesFromSection("bonus-actions", bonusActionsSection);
    const parsedReactions = parseAbilitiesFromSection("reactions", reactionsSection);
    const parsedLegendary = parseAbilitiesFromSection("legendary-actions", legendaryActionsSection);

    const attacks = parsedActions.attacks;

    monsters.push({
      name,
      size,
      kind,
      alignment,
      armorClass,
      initiativeModifier,
      hitPointsMax,
      hitPointsFormula,
      speed: { baseFeet: parsedSpeed.baseFeet, modes: parsedSpeed.modes, raw: speedRaw },
      abilityScores: complete,
      challengeRating,
      proficiencyBonus,
      skillsRaw,
      sensesRaw,
      languagesRaw,
      gear,
      traits: parsedTraits.abilities,
      actions: parsedActions.abilities,
      bonusActions: parsedBonus.abilities,
      reactions: parsedReactions.abilities,
      legendaryActions: parsedLegendary.abilities,
      attacks,
      sourceMarkdown: block,
    });
  }

  return { monsters };
}

export function monsterIdFromName(name: string): string {
  return `monster_${slugify(name)}`;
}
