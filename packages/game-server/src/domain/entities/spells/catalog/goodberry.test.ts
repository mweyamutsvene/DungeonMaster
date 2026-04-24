import { describe, it, expect } from 'vitest';
import { getCanonicalSpell } from './index.js';
import { lookupMagicItemById } from '../../items/magic-item-catalog.js';

describe('Goodberry (level-1)', () => {
  const spell = getCanonicalSpell('Goodberry');

  it('exists in the catalog', () => {
    expect(spell).not.toBeNull();
  });

  it('is level 1', () => {
    expect(spell?.level).toBe(1);
  });

  it('is transmutation school', () => {
    expect(spell?.school).toBe('transmutation');
  });

  it('has Action casting time and VSM components', () => {
    expect(spell?.castingTime).toBe('action');
    expect(spell?.components?.v).toBe(true);
    expect(spell?.components?.s).toBe(true);
    expect(spell?.components?.m).toContain('mistletoe');
  });

  it('has self range and is not concentration', () => {
    expect(spell?.range).toBe('self');
    expect(spell?.concentration).toBeUndefined();
  });

  it('is on the Druid + Ranger class lists', () => {
    expect(spell?.classLists).toEqual(expect.arrayContaining(['Druid', 'Ranger']));
  });

  it('declares a creates_item side-effect for 10 goodberry-berry items with 1-long-rest expiry', () => {
    const sideEffects = spell?.onCastSideEffects;
    expect(sideEffects).toBeDefined();
    expect(sideEffects?.length).toBe(1);
    const [effect] = sideEffects!;
    expect(effect.type).toBe('creates_item');
    if (effect.type === 'creates_item') {
      expect(effect.itemRef.magicItemId).toBe('goodberry-berry');
      expect(effect.quantity).toBe(10);
      expect(effect.longRestsRemaining).toBe(1);
    }
  });

  it('references a resolvable magic item id (goodberry-berry must exist in the item catalog)', () => {
    const item = lookupMagicItemById('goodberry-berry');
    expect(item).toBeDefined();
    expect(item?.name).toBe('Goodberry');
    expect(item?.category).toBe('potion');
  });
});

describe('goodberry-berry (magic item)', () => {
  const berry = lookupMagicItemById('goodberry-berry');

  it('heals exactly 1 HP when eaten (0d0 + 1)', () => {
    expect(berry?.potionEffects?.healing).toEqual({ diceCount: 0, diceSides: 0, modifier: 1 });
  });

  it('costs a bonus action to eat (use: bonus)', () => {
    expect(berry?.actionCosts?.use).toBe('bonus');
  });

  it('costs a free object interaction to hand to a conscious ally', () => {
    expect(berry?.actionCosts?.give).toBe('free-object-interaction');
  });

  it('costs a bonus action to administer (overrides the potion default of utilize, per spell text)', () => {
    expect(berry?.actionCosts?.administer).toBe('bonus');
  });

  it('does not require attunement', () => {
    expect(berry?.attunement.required).toBe(false);
  });
});
