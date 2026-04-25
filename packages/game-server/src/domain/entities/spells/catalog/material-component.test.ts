import { describe, expect, it } from "vitest";
import { parseMaterialComponent } from "./material-component.js";

describe("parseMaterialComponent", () => {
  it("returns null for undefined", () => {
    expect(parseMaterialComponent(undefined)).toBeNull();
  });

  it("passes through structured form with default componentPouchSatisfies=true when no costGp", () => {
    const result = parseMaterialComponent({
      description: "a feather",
      itemKeyword: "feather",
    });
    expect(result).toEqual({
      description: "a feather",
      itemKeyword: "feather",
      componentPouchSatisfies: true,
    });
  });

  it("passes through structured form with default componentPouchSatisfies=false when costGp set", () => {
    const result = parseMaterialComponent({
      description: "a 100gp diamond",
      itemKeyword: "diamond",
      costGp: 100,
    });
    expect(result?.componentPouchSatisfies).toBe(false);
  });

  it("respects explicit componentPouchSatisfies override", () => {
    const result = parseMaterialComponent({
      description: "a diamond",
      itemKeyword: "diamond",
      costGp: 100,
      componentPouchSatisfies: true,
    });
    expect(result?.componentPouchSatisfies).toBe(true);
  });

  it("parses 'a diamond worth 300+ GP, consumed' (Revivify)", () => {
    const result = parseMaterialComponent("a diamond worth 300+ GP, consumed");
    expect(result).toMatchObject({
      description: "a diamond worth 300+ GP, consumed",
      itemKeyword: "diamond",
      costGp: 300,
      consumed: true,
      componentPouchSatisfies: false,
    });
  });

  it("parses 'a diamond worth 50+ GP' (Chromatic Orb) — not consumed", () => {
    const result = parseMaterialComponent("a diamond worth 50+ GP");
    expect(result).toMatchObject({
      itemKeyword: "diamond",
      costGp: 50,
      consumed: false,
      componentPouchSatisfies: false,
    });
  });

  it("parses 'a pinch of diamond dust' — pouch satisfies", () => {
    const result = parseMaterialComponent("a pinch of diamond dust");
    expect(result).toMatchObject({
      itemKeyword: "diamond",
      costGp: undefined,
      consumed: false,
      componentPouchSatisfies: true,
    });
  });

  it("parses 'a small piece of phosphorus, wychwood, or a glow-worm'", () => {
    const result = parseMaterialComponent("a small piece of phosphorus, wychwood, or a glow-worm");
    expect(result).toMatchObject({
      itemKeyword: "phosphorus",
      costGp: undefined,
      componentPouchSatisfies: true,
    });
  });

  it("parses 'a ruby worth 50+ GP, consumed' (Continual Flame)", () => {
    const result = parseMaterialComponent("a ruby worth 50+ GP, consumed");
    expect(result).toMatchObject({
      itemKeyword: "ruby",
      costGp: 50,
      consumed: true,
    });
  });
});
