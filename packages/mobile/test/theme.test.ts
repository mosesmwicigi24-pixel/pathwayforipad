// Mobile design tokens — pure mapping checks (Figma "Nuru Pathway app design").
import { describe, it, expect } from "vitest";
import { palette, radii, type as typ, bandColor } from "../src/theme/tokens";

describe("design tokens", () => {
  it("exposes the brand palette (navy · gold · paper · ink)", () => {
    expect(palette.navy).toBe("#0A2540");
    expect(palette.gold).toBe("#C9A227");
    expect(palette.paper).toBe("#F4F0E8");
    expect(palette.ink).toBe("#0B0B0C");
  });

  it("uses the Figma radii (card 24, button 14, hero 30)", () => {
    expect(radii.card).toBe(24);
    expect(radii.button).toBe(14);
    expect(radii.hero).toBe(30);
  });

  it("has a display + body type scale", () => {
    expect(typ.display.fontSize).toBe(28);
    expect(typ.body.lineHeight).toBe(22);
  });

  it("maps engagement bands to harmonized colors with a fallback", () => {
    expect(bandColor("thriving")).toBe(palette.thriving);
    expect(bandColor("steady")).toBe(palette.steady);
    expect(bandColor("at_risk")).toBe(palette.atRisk);
    expect(bandColor("mystery")).toBe(palette.ink600);
  });
});
