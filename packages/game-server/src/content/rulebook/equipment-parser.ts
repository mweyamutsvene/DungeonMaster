import { parseMarkdownTable } from "../markdown/parse-markdown-table.js";

export type CoinUnit = "cp" | "sp" | "ep" | "gp" | "pp";

export interface Cost {
  amount: number;
  unit: CoinUnit;
}

export interface DiceExpression {
  kind: "dice";
  count: number;
  sides: number;
}

export interface FlatDamage {
  kind: "flat";
  amount: number;
}

export type DamageAmount = DiceExpression | FlatDamage;

export interface WeaponDamage {
  amount: DamageAmount;
  type: string;
}

export type WeaponGroupKind = "melee" | "ranged";
export type WeaponGroupCategory = "simple" | "martial";

export interface WeaponDefinition {
  name: string;
  category: WeaponGroupCategory;
  kind: WeaponGroupKind;
  damage: WeaponDamage;
  properties: string[];
  mastery?: string;
  weightLb?: number;
  cost: Cost;
}

export type ArmorCategory = "light" | "medium" | "heavy" | "shield";

export interface ArmorDefinition {
  name: string;
  category: ArmorCategory;
  ac: string;
  strengthRequirement?: string;
  stealth?: string;
  weightLb?: number;
  cost: Cost;
}

export interface EquipmentDefinitions {
  weapons: WeaponDefinition[];
  armor: ArmorDefinition[];
}

function parseCost(text: string): Cost {
  const t = text.trim();
  const m = t.match(/^([0-9][0-9,]*)\s*(CP|SP|EP|GP|PP)$/i);
  if (!m) {
    throw new Error(`Unrecognized cost: ${text}`);
  }

  const amount = Number(m[1]!.replace(/,/g, ""));
  const unit = m[2]!.toLowerCase() as CoinUnit;
  return { amount, unit };
}

function parseWeightLb(text: string): number | undefined {
  const t = text.trim();
  if (t === "—" || t === "" || t === "-") return undefined;

  const m = t.match(/^([0-9]+(?:\/[0-9]+)?|[0-9]+\.[0-9]+)\s*lb\.?$/i);
  if (!m) return undefined;

  const raw = m[1]!;
  if (raw.includes("/")) {
    const [a, b] = raw.split("/");
    return Number(a) / Number(b);
  }

  return Number(raw);
}

function parseDamage(text: string): WeaponDamage {
  const t = text.trim();
  const m = t.match(/^(.+?)\s+([A-Za-z]+)$/);
  if (!m) {
    throw new Error(`Unrecognized damage: ${text}`);
  }

  const amountText = m[1]!.trim();
  const type = m[2]!.trim().toLowerCase();

  const diceMatch = amountText.match(/^(\d+)d(\d+)$/i);
  if (diceMatch) {
    return {
      amount: {
        kind: "dice",
        count: Number(diceMatch[1]! ),
        sides: Number(diceMatch[2]! ),
      },
      type,
    };
  }

  const flatMatch = amountText.match(/^(\d+)$/);
  if (flatMatch) {
    return { amount: { kind: "flat", amount: Number(flatMatch[1]!) }, type };
  }

  throw new Error(`Unrecognized damage amount: ${amountText}`);
}

function parseProperties(text: string): string[] {
  const t = text.trim();
  if (t === "—" || t === "") return [];
  return t.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
}

function cleanNameCell(nameCell: string): string {
  return nameCell.replace(/\*/g, "").trim();
}

function detectWeaponGroup(nameCell: string): { category: WeaponGroupCategory; kind: WeaponGroupKind } | null {
  const text = cleanNameCell(nameCell).toLowerCase();
  if (!text.includes("weapons")) return null;

  const category: WeaponGroupCategory | null =
    text.includes("simple") ? "simple" : text.includes("martial") ? "martial" : null;
  const kind: WeaponGroupKind | null = text.includes("melee") ? "melee" : text.includes("ranged") ? "ranged" : null;

  if (!category || !kind) return null;
  return { category, kind };
}

function detectArmorCategory(nameCell: string): ArmorCategory | null {
  const text = cleanNameCell(nameCell).toLowerCase();

  if (text.startsWith("shield")) return "shield";

  if (!text.includes("armor")) return null;
  if (text.includes("light")) return "light";
  if (text.includes("medium")) return "medium";
  if (text.includes("heavy")) return "heavy";

  return null;
}

function extractTable(markdown: string, heading: string): string {
  const idx = markdown.toLowerCase().indexOf(heading.toLowerCase());
  if (idx === -1) {
    throw new Error(`Missing section: ${heading}`);
  }

  const after = markdown.slice(idx);
  const lines = after.split(/\r?\n/);

  // Find the first markdown table following the heading.
  const start = lines.findIndex((l) => l.trim().startsWith("|"));
  if (start === -1) {
    throw new Error(`No table found for section: ${heading}`);
  }

  const tableLines: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!line.trim().startsWith("|")) break;
    tableLines.push(line);
  }

  return tableLines.join("\n");
}

export function parseEquipmentMarkdown(markdown: string): EquipmentDefinitions {
  const weaponsTableText = extractTable(markdown, "##### Weapons");
  const armorTableText = extractTable(markdown, "##### Armor");

  const weaponsTable = parseMarkdownTable(weaponsTableText);
  const armorTable = parseMarkdownTable(armorTableText);

  const weapons: WeaponDefinition[] = [];
  let currentWeaponGroup: { category: WeaponGroupCategory; kind: WeaponGroupKind } | null = null;

  for (const row of weaponsTable.rows) {
    const nameCell = row["Name"] ?? "";
    const group = detectWeaponGroup(nameCell);
    if (group) {
      currentWeaponGroup = group;
      continue;
    }

    const name = cleanNameCell(nameCell);
    if (!name) continue;
    if (!currentWeaponGroup) {
      throw new Error(`Weapon row without group header: ${name}`);
    }

    const masteryText = (row["Mastery"] ?? "").trim();

    weapons.push({
      name,
      category: currentWeaponGroup.category,
      kind: currentWeaponGroup.kind,
      damage: parseDamage(row["Damage"] ?? ""),
      properties: parseProperties(row["Properties"] ?? ""),
      mastery: masteryText === "—" || masteryText === "" ? undefined : masteryText,
      weightLb: parseWeightLb(row["Weight"] ?? ""),
      cost: parseCost(row["Cost"] ?? ""),
    });
  }

  const armor: ArmorDefinition[] = [];
  let currentArmorCategory: ArmorCategory | null = null;

  for (const row of armorTable.rows) {
    const armorCell = row["Armor"] ?? "";
    const detected = detectArmorCategory(armorCell);
    if (detected) {
      const acCell = (row["Armor Class (AC)"] ?? "").trim();
      const strengthCell = (row["Strength"] ?? "").trim();
      const stealthCell = (row["Stealth"] ?? "").trim();
      const weightCell = (row["Weight"] ?? "").trim();
      const costCell = (row["Cost"] ?? "").trim();

      // Category header rows have empty/non-data columns.
      const looksLikeHeader =
        acCell === "" && strengthCell === "" && stealthCell === "" && weightCell === "" && costCell === "";

      if (looksLikeHeader) {
        currentArmorCategory = detected;
        continue;
      }
    }

    const name = cleanNameCell(armorCell);
    if (!name) continue;

    // The table includes a shield row that is a real item.
    if (!currentArmorCategory) {
      if (cleanNameCell(armorCell).toLowerCase() === "shield") {
        currentArmorCategory = "shield";
      } else {
        throw new Error(`Armor row without category header: ${name}`);
      }
    }

    armor.push({
      name,
      category: currentArmorCategory,
      ac: (row["Armor Class (AC)"] ?? "").trim(),
      strengthRequirement: (row["Strength"] ?? "").trim() || undefined,
      stealth: (row["Stealth"] ?? "").trim() || undefined,
      weightLb: parseWeightLb(row["Weight"] ?? ""),
      cost: parseCost(row["Cost"] ?? ""),
    });
  }

  return { weapons, armor };
}
