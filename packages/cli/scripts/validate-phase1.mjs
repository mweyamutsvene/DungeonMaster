const base = process.env.DM_BASE_URL ?? "http://127.0.0.1:3001";

async function post(path, body) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${text}`);
  return JSON.parse(text);
}

(async () => {
  const session = await post("/sessions", {});
  console.log("sessionId", session.id);

  const char = await post(`/sessions/${session.id}/characters/generate`, {
    name: "Li Wei",
    className: "monk",
    level: 5,
  });
  console.log("characterId", char.id);

  await post(`/sessions/${session.id}/monsters`, {
    name: "Goblin Warrior",
    statBlock: {
      armorClass: 15,
      hp: 7,
      maxHp: 7,
      abilityScores: {
        strength: 8,
        dexterity: 14,
        constitution: 10,
        intelligence: 10,
        wisdom: 8,
        charisma: 8,
      },
      actions: [
        {
          name: "Scimitar",
          type: "weapon",
          attackBonus: 4,
          damageFormula: "1d6+2",
          damageType: "slashing",
        },
      ],
    },
  });

  await post(`/sessions/${session.id}/monsters`, {
    name: "Goblin Archer",
    statBlock: {
      armorClass: 13,
      hp: 7,
      maxHp: 7,
      abilityScores: {
        strength: 8,
        dexterity: 14,
        constitution: 10,
        intelligence: 10,
        wisdom: 8,
        charisma: 8,
      },
      actions: [
        {
          name: "Shortbow",
          type: "weapon",
          attackBonus: 4,
          damageFormula: "1d6+2",
          damageType: "piercing",
        },
      ],
    },
  });

  const init = await post(`/sessions/${session.id}/combat/initiate`, {
    text: "I attack the goblins",
    actorId: char.id,
  });
  console.log("init", { rollType: init.rollType, type: init.type });

  const rolled = await post(`/sessions/${session.id}/combat/roll-result`, {
    text: "I rolled 16",
    actorId: char.id,
  });
  console.log("encounterId", rolled.encounterId);

  const attack = await post(`/sessions/${session.id}/combat/action`, {
    text: "I attack the Goblin Warrior",
    actorId: char.id,
    encounterId: rolled.encounterId,
  });
  console.log("action.attack", { rollType: attack.rollType, type: attack.type, message: attack.message });

  try {
    await post(`/sessions/${session.id}/combat/action`, {
      text: "use flurry of blows",
      actorId: char.id,
      encounterId: rolled.encounterId,
    });
    console.log("action.flurry", "unexpected success");
  } catch (e) {
    console.log("action.flurry", "expected error:", String(e.message).split("\n")[0]);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
