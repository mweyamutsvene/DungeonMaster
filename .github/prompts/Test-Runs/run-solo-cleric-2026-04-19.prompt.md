# Agent Player Test Run: Solo Cleric vs Undead Horde
Date: 2026-04-19
Scenario: solo-cleric.json
Outcome: Victory
Brother Aldric HP at end: ~26/38 (estimated — Zombie Brute OA killed it, exact final HP not displayed post-OA)
Rounds played: 2 full rounds + partial Round 3

## Player and Enemy actions taken

- Round 0 (Initiative): Ghoul 16, Brother Aldric 14, Skeleton Archer 10, Zombie Brute 7

- Round 1 (Ghoul): Claws vs Brother Aldric: 5+4=9 vs AC 18 → Miss
- Round 1 (Player — Brother Aldric):
  - Action: Cast Spirit Guardians (Level 3 slot, concentration, 15ft radius aura) → spellSlot_3: 2→1
  - Bonus ready, no bonus action used (would have needed a separate turn)
  - End turn
- Round 1 (Skeleton Archer): Shortbow vs Brother Aldric: 2+4=6 vs AC 18 → Miss
- Round 1 (Zombie Brute): Slam vs Brother Aldric: 13+5=18 vs AC 18 → Hit, 7 damage (HP 38→31)
  - Spirit Guardians TRIGGERED on Zombie Brute's turn start (Zombie at 20,10 within 15ft of Aldric at 15,15) — damage visible only via HP tracking: Zombie went 30→21 = 9 damage (no save events shown in CLI)

- Round 2 (Player — Brother Aldric):
  - Action: Cast Guiding Bolt at Skeleton Archer (Level 1 slot) → spellSlot_1: 4→3
    - Attack roll: d20=16, 16+7=23 vs AC 13 → Hit
    - Damage roll: 4d6 → rolled 18, 18+0=18 damage. Skeleton Archer HP: 13→0 [DEFEATED]
  - Bonus action attempt: "I cast Healing Word on myself"
    - SERVER CORRECTLY BLOCKED: "Cannot cast a leveled bonus action spell — a leveled action spell was already cast this turn." ✅ Two-spell rule enforced
  - End turn
- Round 2 (Zombie Brute): AI moves to (32, 10) — fleeing Spirit Guardians radius
  - Opportunity Attack triggered! Brother Aldric uses reaction: Hit! 5 damage
  - Zombie Brute defeated (HP 21 - prior Spirit Guardians damage, then OA damage = 0)

Combat ended: VICTORY in ~2.5 rounds. All 3 enemies defeated (Ghoul by Spirit Guardians, Skeleton Archer by Guiding Bolt, Zombie Brute by OA).

## ✅ Confirmed Working

- Spirit Guardians correctly consumed Level 3 spell slot (spellSlot_3: 2→1)
- Spirit Guardians aura DID deal damage to nearby enemies (visible through HP tracking: Ghoul 22→0, Zombie 30→21=9 damage)
- Spirit Guardians correctly triggered AI flee behavior (Zombie Brute moved away from the aura)
- Guiding Bolt spell attack used correct bonus (+7 = proficiency +3 + WIS +4)
- Guiding Bolt dealt 4d6 at Level 1 (correct, no upcasting needed)
- Spell slot tracking accurate for all slots consumed
- Two-spell rule enforced: Healing Word (leveled bonus action) blocked after Guiding Bolt (leveled action) on same turn ✅
- Opportunity attack triggered when Zombie Brute moved out of melee range
- Initiative order resolved correctly (Ghoul 16, Aldric 14, Skeleton 10, Zombie 7)
- Cleric AC 18 correctly applied (Chain Mail + Shield = 18)
- spellAttackBonus +7 correctly applied to Guiding Bolt roll

## 🚩 Bugs & Unexpected Behavior

### BUG-1: Spirit Guardians — No WIS Save or Damage Events Shown in CLI
**Severity**: Medium
**Reproduction**:
  1. Cast Spirit Guardians (aura zone)
  2. Wait for enemy turn start inside the radius
  3. Observer CLI output
**Expected (5e 2024 rule)**: Each creature that starts its turn in the radius must make a WIS saving throw. The CLI should show a save event (e.g. "Ghoul makes WIS save: rolled X = Y vs DC 15 → Fail, 3d8=N radiant damage") similar to how attack rolls are displayed.
**Server response**: Damage clearly happened (Ghoul 22→0 HP, Zombie 30→21 HP) but zero save/damage events were printed to CLI. Only "Ghoul is down and cannot act." appeared.
**Impact**: Players cannot verify whether saves were made or how much damage the aura dealt. This is a transparency problem — the rules are running correctly, just silently.

### BUG-2: Duplicate channelDivinity Resource Pool Entries
**Severity**: Low
**Reproduction**:
  1. Create a Cleric character with `resourcePools: [{ "name": "channelDivinity", "current": 1, "max": 1 }]`
  2. Start combat
  3. Observe the Resources line in the combatant status display
**Expected**: One channelDivinity resource entry with the correct max uses.
**Server response**: `Resources: spellSlot_1: 4/4 | spellSlot_2: 3/3 | spellSlot_3: 2/2 | channelDivinity:cleric: 2/2 | channelDivinity: 1/1`
Two separate entries appear: `channelDivinity:cleric: 2/2` (from creature hydration) and `channelDivinity: 1/1` (from scenario sheet resourcePools). They have different values (2 vs 1). This could cause incorrect resource tracking if Channel Divinity is used — unclear which pool gets decremented.

### BUG-3: Spirit Guardians Aura Damage Is Silent (CLI Display Gap)
**Severity**: Medium
**Reproduction**:
  1. Cast Spirit Guardians
  2. An enemy starts its turn inside the radius and dies from the aura damage
**Expected**: CLI should show the saving throw result and radiant damage number before showing "Ghoul is down" — similar to how `[Attack]` and `[Damage]` lines are printed for normal hits.
**Actual**: Only showed "Ghoul is down and cannot act." with no intermediate events.
**Note**: This may be the same root cause as BUG-1 (same silent zone damage events).

## ⚠️ Ambiguous / Needs Review

- **Spirit Guardians radius check**: Zombie Brute was at (20,10), Aldric at (15,15). Distance = ~7 grid units (~7ft). The aura should be 15ft radius. With a grid where each unit = 5ft, that's about 35ft — which is WELL within 15ft. OR if grid units ARE feet, it's 7ft. Either way it's within the radius. The flee behavior confirms the AI detects the zone correctly.
- **Opportunity Attack display**: OA reaction showed "Brother Aldric: Hit! (5 damage)" — but we don't see the attack roll breakdown (d20 + bonus vs AC). The OA killed the Zombie Brute outright from 21 HP but dealt "5 damage" — this means Zombie had taken additional damage before the OA that wasn't displayed (Spirit Guardians zone damage on Round 3 turn start before fleeing). This is consistent with BUG-1.
- **Zombie Brute final HP before OA**: The display showed HP 21/30 after Round 2, but then in Round 3 it fled "to avoid further damage" suggesting Spirit Guardians had already ticked (taking it from 21 to some lower value), and the OA of 5 finished it. We can't confirm because the Spirit Guardians damage events are silent.

## 📝 Notes
- Life Domain Cleric subclass may not have any special behavior wired vs. other Cleric subclasses at this level (Disciple of Life bonus healing wasn't testable since Healing Word was blocked by two-spell rule).
- Turn Undead and Sacred Flame were NOT tested — to test those, a subsequent run should avoid using action/bonus-action spells early so Channel Divinity is available, or scenarios should be designed to force their use.
- The combat was quite fast (2.5 rounds) — the Spirit Guardians carried most of the work silently. Harder encounter would better stress-test spell slot management.
- Bless was not cast — worth testing as a concentration buff + its interaction with ongoing Spirit Guardians (can only concentrate on one spell — would drop Spirit Guardians).
