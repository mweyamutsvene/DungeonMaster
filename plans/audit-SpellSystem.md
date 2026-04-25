---
type: sme-research
flow: SpellSystem
feature: mechanics-audit-l1-5
author: claude-explore-spell-system
status: DRAFT
created: 2026-04-24
updated: 2026-04-25
---

## Scope

SpellSystem flow: casting pipeline, delivery modes, zone effects, concentration mechanics. Files: `tabletop/spell-action-handler.ts`, `tabletop/spell-cast-side-effect-processor.ts` (new), `domain/rules/concentration.ts`, `domain/entities/spells/` (non-catalog), `tabletop/spell-delivery/`.

## Currently Supported

- **Slot economy**: tracking, consumption, ritual casting (`castAsRitual` flag). Hunter's Mark uses Favored Enemy pool.
- **Delivery modes**: attack rolls (spell attack, multi-attack/cantrip scaling), healing, save spells (AoE sphere/cone/cube/line/cylinder), buff/debuff (concentration duration), zones (auras, persistent). Auto-hit (Magic Missile).
- **Spell attack vs saves**: DC = 8 + prof + mod. Attack bonus = prof + mod. Cover handling, evasion, `ignoresCover` flag.
- **Concentration**: full lifecycle (gain, break on damage/condition/HP≤0, replacement, zone persistence). Check: DC = max(10, floor(dmg/2)).
- **Upcasting**: dice scaling (`additionalDice`) + flat scaling (`upcastFlatBonus`). Validated (≥base, ≤9). Cantrips reject.
- **Cantrip scaling**: 1/2/3/4× at L1/5/11/17 via `getCantripDamageDice()`.
- **Counterspell (2024)**: level ≥ target → auto-counter. Level < target → d20 + spellcasting ability check (DC = 10 + target level). **Correct 2024 RAW, not 2014.** (Note: 2024 Counterspell is actually a Con save by target caster — verify this matches.)
- **Components**: Verbal enforced (`cannotSpeak` blocks cast). Somatic/material cataloged but **not enforced**.
- **Spell prep**: catalog-first with sheet override. **No distinction between prepared/known.**
- **Spell DC & bonus**: computed correctly. Fallback defaults (13, +5) for missing caster.

## Needs Rework

1. **Delivery handler chain** — `canHandle()` order-dependent (Spell Attack → Healing → Save → Zone → BuffDebuff). Hypothetical "save+effect on success" would route to Save (wrong). Needs spell type tags in catalog.
2. **Spell save DC stale** — computed at multiple points; caster sheet hydration gap between prep and delivery.
3. **Concentration break silent** — no narrative events when concentration ends (zone removal invisible to player).
4. **Single-target only in AoE path** — `SaveSpellDeliveryHandler.handleAoE()` exists but requires explicit `targetName`; `getCreaturesInArea()` not invoked. **Burning Hands etc. need manual comma-separated target names.**
5. **No slot refund on Counterspell failure** — both attempted and successful Counterspells consume slot; refund logic missing.
6. **Counterspell 2024 compliance** — verify it's a Con save by target (not 2014 ability check by counterer).

## Missing — Required for L1-5

### P0 (blocks play)
- **Dispel Magic (L3)** — NOT implemented. No catalog entry, no handler. Blocks Wizard/Cleric/Druid/Bard L3+ gameplay.
- **Auto-AoE target resolution** — Burning Hands (cone) / Thunderwave (cube) / Fireball (sphere) require manual target naming; cannot infer "all in area."
- **Material component enforcement** — components declared in catalog, zero inventory checks at cast time (Revivify 300gp diamond, Raise Dead etc.).

### P1
- **War Caster feat** — Concentration save advantage never applied (`concentrationSaveRollMode` hardcoded false).
- **Somatic component free-hand validation** — can't cast somatic with both hands full without Warcaster.
- **Spiritual Weapon multi-round bonus action** — not implemented (L2 cleric staple).
- **Mirror Image duplicate AC override** — not wired into hit-resolution.
- **Haste speed_multiplier** — not resolved in damage-resolver.
- **Slot refund on counterspell failure.**

### P2
- **Ritual casting UX** — declared but timing/integration shallow.

## Cross-Flow Dependencies

- **AI Planning** — AI ignores concentration flag; can plan two concentration spells per turn. (AIBehavior coordinate.)
- **Reaction Priority** — no order if multiple reactions triggered (OA, Counterspell, Shield) in same window. (ReactionSystem coordinate.)
- **Zone Immediate Movement** — aura zones move with caster instantly; creatures re-evaluate next turn only.
- **SpellCatalog** — catalog schema must expose `upcastScaling`, `templateShape`, `concentrationValuePerTurn`.
- **CombatRules** — concentration save DC consumption, cover interaction.
- **EntityManagement** — slot storage, prepared spell tracking, concentration pointer.

## Summary

**Overall status: 70–75% L1-5 ready.** Slot economy, delivery modes, concentration lifecycle, attack/save resolution, upcasting, cantrip scaling, Counterspell (mostly 2024) all work.

**Critical gaps:** (1) **Dispel Magic missing entirely**, (2) **material component enforcement absent**, (3) **auto-AoE targeting broken** (requires manual naming), (4) **War Caster feat broken**.

**Recommend before L5 push:** Dispel Magic + handler, War Caster integration, auto-AoE targeting, handler decomposition by type tag.


## R2 Refresh (2026-04-25)

- R2 validated: Dispel Magic is implemented and scenario-covered.
- R2 correction: material components are partial (validation exists; decrement writeback remains).
- Remaining concern: War Caster concentration advantage integration and broader AoE quality hardening.
