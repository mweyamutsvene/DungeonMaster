# PowerShell Command History - Combat Testing Session

Complete record of all PowerShell commands used during combat testing (Session: I83-q7P9O_Af4bQLIC8U1).

---

## Session Setup

### 1. Create Session
```powershell
Invoke-RestMethod -Uri "http://localhost:3001/sessions" -Method Post -ContentType "application/json" -Body '{}'
```

### 2. Generate Monk Character (Li Wei)
```powershell
Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/characters/generate" -Method Post -ContentType "application/json" -Body '{"name":"Li Wei","className":"monk","level":5}'
```

### 3. Spawn Goblin Warrior
```powershell
# NOTE: Use 'actions' field (not 'attacks') for monster abilities
Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/monsters" -Method Post -ContentType "application/json" -Body (@{name="Goblin Warrior";statBlock=@{armorClass=15;hp=12;maxHp=12;abilityScores=@{strength=8;dexterity=14;constitution=10;intelligence=10;wisdom=8;charisma=8};actions=@(@{name="Scimitar";type="weapon";attackType="melee";attackBonus=4;damage=@{diceCount=1;diceSides=6;modifier=2};damageType="slashing"})}} | ConvertTo-Json -Depth 10)
```

---

## Combat Flow

### 4. Initiate Combat
```powershell
Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/combat/initiate" -Method Post -ContentType "application/json" -Body '{"text":"I attack the Goblin Warrior","actorId":"9ib84Yz9rhm9thFs5yCfC"}'
```

### 5. Submit Initiative Roll
```powershell
Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/combat/roll-result" -Method Post -ContentType "application/json" -Body '{"text":"I rolled 14","actorId":"9ib84Yz9rhm9thFs5yCfC"}'
```

### 6. Move Action
```powershell
# First move (11 feet)
Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/combat/action" -Method Post -ContentType "application/json" -Body '{"text":"move closer to the Goblin Warrior","actorId":"9ib84Yz9rhm9thFs5yCfC","encounterId":"oe2VOWprgNYHiz5NBPEYC"}'

# Second move (8 feet to position 12,3)
Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/combat/action" -Method Post -ContentType "application/json" -Body '{"text":"move to (12, 3)","actorId":"9ib84Yz9rhm9thFs5yCfC","encounterId":"oe2VOWprgNYHiz5NBPEYC"}'
```

### 7. Unarmed Strike Attack
```powershell
Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/combat/action" -Method Post -ContentType "application/json" -Body '{"text":"I attack the Goblin Warrior with unarmed strike","actorId":"9ib84Yz9rhm9thFs5yCfC","encounterId":"oe2VOWprgNYHiz5NBPEYC"}'
```

### 8. Submit Attack Roll
```powershell
Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/combat/roll-result" -Method Post -ContentType "application/json" -Body '{"text":"I rolled 16","actorId":"9ib84Yz9rhm9thFs5yCfC"}'
```

### 9. Submit Damage Roll
```powershell
Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/combat/roll-result" -Method Post -ContentType "application/json" -Body '{"text":"I rolled 6","actorId":"9ib84Yz9rhm9thFs5yCfC"}'
```

### 10. End Turn
```powershell
Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/actions" -Method Post -ContentType "application/json" -Body (@{kind="endTurn";encounterId="oe2VOWprgNYHiz5NBPEYC";actor=@{type="Character";characterId="9ib84Yz9rhm9thFs5yCfC"}} | ConvertTo-Json -Depth 10)
```

---

## Query Combat State

### Get Combat State
```powershell
Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/combat?encounterId=oe2VOWprgNYHiz5NBPEYC" -Method Get
```

### Get Combat State (Formatted)
```powershell
$combat = Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/combat?encounterId=oe2VOWprgNYHiz5NBPEYC" -Method Get
Write-Host "`n=== Combat Status ==="
Write-Host "Round: $($combat.encounter.round)"
Write-Host "Turn: $($combat.encounter.turn)"
Write-Host "Status: $($combat.encounter.status)"
Write-Host "`n=== Combatants ==="
$combat.combatants | ForEach-Object { Write-Host "$($_.combatantType): HP $($_.hpCurrent)/$($_.hpMax), Initiative: $($_.initiative)" }
Write-Host "`nActive Combatant: $($combat.activeCombatant.combatantType)"
```

### Get Tactical State
```powershell
Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/combat/oe2VOWprgNYHiz5NBPEYC/tactical" -Method Get
```

### Get Tactical State (Positions)
```powershell
$tactical = Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/combat/oe2VOWprgNYHiz5NBPEYC/tactical" -Method Get
$tactical.combatants | Select-Object name, position, distanceFromActive
```

---

## Query Events

### Get Recent Events (JSON)
```powershell
Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/events-json?limit=10" -Method Get
```

### Get All Recent Events (Formatted)
```powershell
$events = Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/events-json?limit=50" -Method Get
Write-Host "`n=== All Recent Events ===`n"
$events | Where-Object { $_.createdAt -gt '2026-01-13T07:16:00Z' } | ForEach-Object {
    Write-Host "[$($_.type)] - $($_.createdAt)"
    if ($_.type -eq 'NarrativeText') { Write-Host "  Text: $($_.payload.text)" }
    if ($_.type -eq 'AttackResolved') { Write-Host "  Hit: $($_.payload.result.hit), Damage: $($_.payload.result.damage.applied)" }
    if ($_.type -eq 'DamageApplied') { Write-Host "  Damage: $($_.payload.amount), HP: $($_.payload.hpCurrent)" }
    Write-Host ""
}
```

### Get Goblin's Turn Events
```powershell
$events = Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/events-json?limit=20" -Method Get
Write-Host "`n=== Goblin's Turn (Round 1, Turn 1) ===`n"
$events | Where-Object { $_.type -in @('AiDecision','NarrativeText','Move','AttackResolved') -and $_.createdAt -gt '2026-01-13T07:13:40Z' } | ForEach-Object {
    Write-Host "[$($_.type)]"
    if ($_.type -eq 'NarrativeText') { Write-Host "  $($_.payload.text)" }
    if ($_.type -eq 'Move') { Write-Host "  Moved from ($($_.payload.from.x),$($_.payload.from.y)) to ($($_.payload.to.x),$($_.payload.to.y)) - $([math]::Round($_.payload.distanceMoved,1)) feet" }
    Write-Host ""
}
```

### Get Specific Event Type (AttackResolved)
```powershell
$events = Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/events-json?limit=30" -Method Get
$attackEvent = $events | Where-Object { $_.type -eq 'AttackResolved' } | Select-Object -First 1
$attackEvent | ConvertTo-Json -Depth 10
```

### Get Specific Event Type (DamageApplied)
```powershell
$events = Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/events-json?limit=30" -Method Get
Write-Host "`n=== DamageApplied Event ===`n"
$damageEvent = $events | Where-Object { $_.type -eq 'DamageApplied' } | Select-Object -First 1
$damageEvent | ConvertTo-Json -Depth 10
```

### Get Narrative Events Only
```powershell
$events = Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/events-json?limit=50" -Method Get
$narrativeEvents = $events | Where-Object { $_.type -eq 'NarrativeText' -and $_.createdAt -gt '2026-01-13T07:16:20Z' }
Write-Host "`n=== Auto-Generated Combat Narratives ===`n"
$narrativeEvents | ForEach-Object {
    Write-Host "[$($_.createdAt)]"
    Write-Host "  $($_.payload.text)"
    Write-Host ""
}
```

---

## LLM Narrative Generation

### Request Narrative for Single Event
```powershell
$events = Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/events-json?limit=10" -Method Get
$attackEvent = $events | Where-Object { $_.type -eq 'AttackResolved' } | Select-Object -First 1
$narrativeBody = @{ events = @($attackEvent) } | ConvertTo-Json -Depth 10
Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/llm/narrate" -Method Post -ContentType "application/json" -Body $narrativeBody
```

### Request Narrative for Multiple Events
```powershell
$events = Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/events-json?limit=50" -Method Get
$combatEvents = $events | Where-Object { $_.type -in @('AttackResolved','DamageApplied') -and $_.createdAt -gt '2026-01-13T07:16:20Z' } | Sort-Object createdAt
$narrativeBody = @{ events = $combatEvents } | ConvertTo-Json -Depth 10
$result = Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/llm/narrate" -Method Post -ContentType "application/json" -Body $narrativeBody
$result.narrative
```

### Test Multiple Narrative Generations (Same Event)
```powershell
$events = Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/events-json?limit=10" -Method Get
$attackEvent = $events | Where-Object { $_.type -eq 'AttackResolved' } | Select-Object -First 1
$narrativeBody = @{ events = @($attackEvent) } | ConvertTo-Json -Depth 10

Write-Host "`n=== First Call ==="
$result1 = Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/llm/narrate" -Method Post -ContentType "application/json" -Body $narrativeBody
Write-Host $result1.narrative

Write-Host "`n=== Second Call (same event) ==="
$result2 = Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/llm/narrate" -Method Post -ContentType "application/json" -Body $narrativeBody
Write-Host $result2.narrative
```

### View Full JSON Sent to LLM
```powershell
$events = Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/events-json?limit=50" -Method Get
$attackEvent = $events | Where-Object { $_.type -eq 'AttackResolved' -and $_.createdAt -gt '2026-01-13T07:16:20Z' } | Select-Object -First 1
$narrativeBody = @{ events = @($attackEvent) } | ConvertTo-Json -Depth 10
Write-Host "`n=== JSON Sent to LLM ===`n"
$narrativeBody
Write-Host "`n`n=== LLM Response ===`n"
$result = Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/llm/narrate" -Method Post -ContentType "application/json" -Body $narrativeBody
$result.narrative
```

### View Full Event Payload
```powershell
$events = Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/events-json?limit=50" -Method Get
$attackEvent = $events | Where-Object { $_.type -eq 'AttackResolved' -and $_.createdAt -gt '2026-01-13T07:16:20Z' } | Select-Object -First 1
Write-Host "`n=== Full AttackResolved Event Payload ===`n"
$attackEvent.payload | ConvertTo-Json -Depth 10
```

---

## Debug Commands

### Enable LLM Debug Logging
```powershell
$env:DM_LLM_DEBUG='1'
```

### Test with Debug Logging
```powershell
$env:DM_LLM_DEBUG='1'
$events = Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/events-json?limit=50" -Method Get
$attackEvent = $events | Where-Object { $_.type -eq 'AttackResolved' -and $_.createdAt -gt '2026-01-13T07:16:20Z' } | Select-Object -First 1
$narrativeBody = @{ events = @($attackEvent) } | ConvertTo-Json -Depth 10
Write-Host "`n=== Calling /llm/narrate with DM_LLM_DEBUG=1 ===`n"
Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/llm/narrate" -Method Post -ContentType "application/json" -Body $narrativeBody | Out-Null
Write-Host "Check the server terminal for debug output!"
```

### Display AttackResolved Event Details
```powershell
$events = Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/events-json?limit=50" -Method Get
$attackEvent = $events | Where-Object { $_.type -eq 'AttackResolved' -and $_.createdAt -gt '2026-01-13T07:16:20Z' } | Select-Object -First 1
$narrativeBody = @{ events = @($attackEvent) } | ConvertTo-Json -Depth 10
Write-Host "`n=== Sending Only AttackResolved Event ===`n"
Write-Host "Event Type: $($attackEvent.type)"
Write-Host "Hit: $($attackEvent.payload.result.hit)"
Write-Host "Attack Roll: d20=$($attackEvent.payload.result.attack.d20), Total=$($attackEvent.payload.result.attack.total)"
Write-Host "Damage in Event: $($attackEvent.payload.result.damage.applied)"
Write-Host "`n=== LLM Narrative ===`n"
$result = Invoke-RestMethod -Uri "http://localhost:3001/sessions/I83-q7P9O_Af4bQLIC8U1/llm/narrate" -Method Post -ContentType "application/json" -Body $narrativeBody
$result.narrative
```

---

## Session IDs Used

- **Session ID**: `I83-q7P9O_Af4bQLIC8U1`
- **Character ID**: `9ib84Yz9rhm9thFs5yCfC` (Li Wei - Level 5 Monk)
- **Monster ID**: `EkksxLFqM2rjH9mlUuhxA` (Goblin Warrior)
- **Encounter ID**: `oe2VOWprgNYHiz5NBPEYC`
- **Combatant ID (Li Wei)**: `l4Av0YOT0v43xKSi99zFF`

---

## Notes

- All commands use the actual session/character/monster/encounter IDs from this testing session
- Replace IDs with your own when running commands in a new session
- LLM debug output appears in the server terminal, not the client
- Event timestamps are in ISO 8601 format (UTC)
- Most queries support `limit` parameter to control result size
