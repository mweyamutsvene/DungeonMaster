# Agent Player Test Run: Solo Warlock
Date: 2026-04-17
Scenario: solo-warlock
Outcome: Victory
Malachar HP at end: 19/38
Rounds played: 4

## Character
- Malachar the Dark — Level 5 Warlock
- HP 38, AC 14, CHA 18 (+4), STR 10, DEX 14, CON 14
- Pact Magic: 2× Level 3 slots
- Cantrip: Eldritch Blast (2 beams at level 5, 1d10 force per beam)
- Spells: Hex (concentration, bonus action; 1d6 extra damage on attacks vs hexed target)
- Equipment: Pact Blade (Shortsword, 1d6+4 CHA)

## Enemies
- Shadow Construct: HP 52, AC 12 — DEFEATED in round 3
- Spectral Guard: HP 22, AC 11 — DEFEATED in round 4

---

## ✅ Confirmed Working

- **Eldritch Blast 2 beams at level 5**: Correctly prompted "beam 1 of 2" and "beam 2 of 2".
- **Each beam = 1d10 force damage** (not 2d10 or 1d6): Correct.
- **Beam 2 fires even after beam 1 hits**: Both beams chain correctly in the hit path.
- **Hex concentration tag on cast**: `Cast hex affecting 1 target(s). [concentration]` shown correctly.
- **Hex +1d6 on hexed target (Shadow Construct)**: Damage prompt showed `1d10+1d6[hex]` and `1d6+4+1d6[hex]` for both Eldritch Blast and Pact Blade attacks. Hex bonus applied to damage.
- **Pact Magic 2/2 → 1/2 after casting Hex**: Decremented correctly after the Hex bonus action.
- **Pact Blade (Shortsword) recognized**: Attack roll prompted, `1d6+4` + `1d6[hex]` shown on hit.
- **Eldritch Blast spell attack bonus +7**: CHA +4 + Proficiency +3 = +7. Correct at level 5.
- **Pact Magic only shows level 3 slots**: No lower-level slots displayed (correct for warlocks).
- **Concentration mechanic tag displayed**: [concentration] shown on Hex cast.
- **Victory detected on all enemies reaching 0 HP**.

---

## 🚩 Bugs & Unexpected Behavior

### BUG-WL1: Hex Damage Formula Display — Arithmetic Wrong
**Severity**: Medium
**Reproduction**:
  1. Cast Hex on Shadow Construct (bonus action)
  2. Cast Eldritch Blast, hit with beam 1
  3. Server prompts `Roll 1d10+1d6[hex] for damage`
  4. Enter `14` as the combined roll (e.g., 8 for d10 + 6 for Hex d6)
**What happened**: Output shows `14 + 0 = 20 damage`. The server applied the full `14` as the die value and added 0, silently computing 20 by treating 14 as the combined total somehow, OR the Hex bonus was already baked into the player-supplied number.
**Expected (5e 2024 rule)**: The display should show the breakdown: `8 + 6[hex] = 14` or at minimum `14 + 0 = 14` if treating as combined roll. Showing `14 + 0 = 20` is arithmetically impossible and misleading.
**Server responses**:
  - `14 + 0 = 20 damage to Shadow Construct! HP: 52 → 32`
  - `5 + 4 = 12 damage to Shadow Construct! HP: 12 → 0` (Pact Blade: rolled 5, modifier +4, but Hex dice added silently — 5 + 4 + 3[hex?] = 12)
**Note**: Same formula display bug appears on Pact Blade (BUG-WL3 below is the same root cause).

---

### BUG-WL2: Hex Retargeting (Bonus Action on Target Death) Fails
**Severity**: Medium
**Reproduction**:
  1. Cast Hex on Shadow Construct (round 1)
  2. Shadow Construct dies (round 3)
  3. On round 3 turn, send: `"I use my bonus action to move Hex to Spectral Guard, then cast Eldritch Blast at Spectral Guard"`
**What happened**: Server ignored the Hex retargeting command. Subsequent Eldritch Blast attacks against Spectral Guard showed only `1d10` (no `[hex]`). Bonus action economy stayed "Bonus ready" — the retargeting was silently dropped.
**Expected (5e 2024 rule)**: When the hexed target dies, the Warlock may use a Bonus Action on their turn to move Hex to a new creature. Hex damage (+1d6) should then apply to the new target.
**Server responses**:
  - `Casting eldritch blast at spectral guard (beam 1 of 2). Roll a d20 for spell attack.` (no Hex retarget acknowledgment)
  - `Hit! Roll 1d10 for damage` (should be `Roll 1d10+1d6[hex] for damage`)
  - `Turn economy: | Action spent | Bonus ready` (bonus not consumed for retargeting)

---

### BUG-WL3: Pact Blade Damage Formula Display Wrong (Same Root as WL1)
**Severity**: Low
**Reproduction**:
  1. Hex active on Shadow Construct
  2. Attack with Pact Blade (Shortsword)
  3. Server shows `Roll 1d6+4+1d6[hex] for damage`; enter `5`
**What happened**: Output shows `5 + 4 = 12 damage`. Math: 5 (die roll) + 4 (CHA modifier) = 9, not 12. The Hex die (3) was applied silently to total.
**Expected**: Display should show `5 + 4 + 3[hex] = 12` or `5 + 7 = 12` (with combined modifier). The `+ 0` or hidden addition is confusing.
**Server response**: `5 + 4 = 12 damage to Shadow Construct! HP: 12 → 0`

---

### BUG-WL4: Beam 2 Still Prompts After Target Dies from Beam 1
**Severity**: Low
**Reproduction**:
  1. Spectral Guard at 6 HP
  2. Eldritch Blast beam 1 deals 8 damage → Spectral Guard to 0 HP
  3. Server shows: `8 + 0 = 8 damage to Spectral Guard! HP: 6 → 0. Beam 2 of 2: Roll a d20.`
  4. Beam 2 attack prompt appears; after sending, server resolves against 0 HP target
**What happened**: Server showed `5 + 0 = 5 damage to Spectral Guard! HP: 0 → 0. Victory!` — beam 2 resolved against already-dead target.
**Expected (5e 2024 rule)**: When the only valid target is dead after beam 1, beam 2 should either be cancelled (wasted) or the player should be offered the option to target a different creature. Applying damage to a 0 HP creature is harmless but confusing.
**Note**: In a multi-enemy scenario, the player should be able to redirect beam 2 to a different target. The server currently locks all beams to the same target declared upfront.

---

### BUG-2 (Existing — Reproduced): Opportunity Attack 404 Pending Action Not Found
**Severity**: High
**Reproduction** (occurred twice in this run):
  1. Player accepts OA prompt (y)
  2. System acknowledges `✅ [Reaction] uses opportunity_attack`
  3. Movement completes
  4. `✗ Reaction failed: HTTP 404 Not Found: Pending action not found: <id>`
**First occurrence**: Shadow Construct moving away in round 2 — `Pending action not found: l_AU90YkDkpAAnBN7KI5y`
**Second occurrence**: Spectral Guard OA when Malachar moved in round 3 — `Move completion failed: HTTP 404 Not Found: Pending action not found: VA6i5Pr-WQFVsrV2wF8Vv`
**Expected**: OA resolves with attack roll and damage, reaction flag consumed.
**Impact**: Both OAs silently failed. No attack roll was requested. Reaction economy appeared to reset correctly despite the error.

---

## ⚠️ Ambiguous / Needs Review

### Concentration Save Not Triggered on 12 Damage
- Round 2: Shadow Construct dealt 12 damage to Malachar (HP 38 → 26). Hex is an active concentration spell.
- Per 5e 2024: Whenever a concentrating caster takes damage, they must make a CON saving throw (DC = max(10, half damage taken) = max(10, 6) = DC 10).
- **No CON save was prompted.** Hex concentration was not broken (Hex remained active through the rest of combat).
- This could be a genuine bug (concentration saves not implemented for player characters) or by design (server may auto-pass to avoid interrupting flow). Needs verification.

### `spellSlot_3` Never Decremented
- `spellSlot_3: 2/2` at start and remained `2/2` through all rounds despite Hex consuming a Pact Magic slot.
- `pactMagic: 2/2 → 1/2` correctly decremented after Hex.
- **Dual tracking issue**: Warlock Pact Magic slots appear tracked via both `pactMagic` AND `spellSlot_3`. Only `pactMagic` decremented. If both are meant to track the same resource, `spellSlot_3` should mirror `pactMagic`.
- Alternatively if they are separate (Pact Magic vs regular spell slots), then warlock shouldn't show `spellSlot_3` at all since warlocks don't have regular spell slots.

### Spectral Guard Never Acted (AI Passivity Bug)
- Throughout all 4 rounds, Spectral Guard never moved or attacked.
- AI narration messages: "unable to act or move" (R1), "holds its position, awaiting" (R2/R3), "cannot move or attack" (R4).
- R4 note: Spectral Guard was at (25, 15) and Malachar at (35, 0) — ~18 ft distance, WITHIN the Spectral Guard's 30 ft movement range. It could have moved 20 ft to close and attacked.
- This may indicate an AI decision bug where the Spectral Guard never evaluates movement or attack opportunities, or its stat block is missing attack actions.
- **Impact**: Malachar only took 12 damage total (from Shadow Construct). The encounter was far too easy.

---

## 📝 Notes

- **Round summary**:
  - R1 (Malachar): Hex (BA) on Shadow Construct + Eldritch Blast (2 beams, both hit) = 20+20 = 40 damage dealt. SC: 52 → 12.
  - R1 (enemies): Spectral Guard skipped. Shadow Construct — no action logged.
  - R2 (Malachar): end turn.
  - R2 (enemies): Spectral Guard skipped. Shadow Construct moved in, hit for 12 (HP 38→26), moved away (OA attempted, 404 error).
  - R3 (Malachar): Pact Blade on Shadow Construct (Hex hit, 12 damage, SC dies). Attempted Hex retarget to Spectral Guard via BA (silently failed). Eldritch Blast on Spectral Guard (2 beams, both hit) = 9+7 = 16 damage. SG: 22 → 6.
  - R3 (enemies): Spectral Guard skipped again.
  - R4 (Malachar): Eldritch Blast on Spectral Guard (beam 1 deals 8, SG dies; beam 2 still fires for 5 vs dead target). VICTORY.
- Malachar's HP at end: 19/38 (took 19 damage total from 1 Shadow Construct attack, 12 damage, and HP going from 26 to 19 during Pact Blade movement — the move completion failure may have cost 7 HP that isn't accounted for, or there was collateral damage from OA/move that wasn't logged clearly).
  - Actually: HP 38 → 26 (Shadow Construct hit for 12) → 19 (lost 7 HP somewhere — possibly from the failed Spectral Guard OA in round 3 that showed "Move completion failed" but damage may have still applied).
- No second spell slot was tested (only Hex was cast from Pact Magic).
- `spellSlot_3` tracking never changed — dual tracking inconsistency flagged.
- Hex concentration persisted through the entire fight despite caster taking damage with no save prompted.
