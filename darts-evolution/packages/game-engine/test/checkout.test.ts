import { dartScore } from "@darts-evolution/shared";
import { describe, expect, it } from "vitest";
import { canCheckout, evaluateOut, isFinishingDart, suggestCheckouts } from "../src/checkout.js";

describe("calculateur de checkout", () => {
  it("propose les sorties classiques", () => {
    expect(suggestCheckouts(170, { outRule: "double" })[0]?.display).toEqual(["T20", "T20", "Bull"]);
    expect(suggestCheckouts(100, { outRule: "double" })[0]?.labels).toEqual(["T20", "D20"]);
    expect(suggestCheckouts(40, { outRule: "double" })[0]?.labels).toEqual(["D20"]);
    expect(suggestCheckouts(50, { outRule: "double" })[0]?.labels).toEqual(["BULL"]);
    expect(suggestCheckouts(2, { outRule: "double" })[0]?.labels).toEqual(["D1"]);
    expect(suggestCheckouts(3, { outRule: "double" })[0]?.labels).toEqual(["S1", "D1"]);
    expect(suggestCheckouts(32, { outRule: "double" })[0]?.labels).toEqual(["D16"]);
  });

  it("identifie exactement les scores impossibles en double sortie (2 à 170)", () => {
    const impossible = [];
    for (let v = 2; v <= 170; v++) if (!canCheckout(v, "double")) impossible.push(v);
    expect(impossible).toEqual([159, 162, 163, 165, 166, 168, 169]);
    expect(canCheckout(171, "double")).toBe(false);
    expect(canCheckout(1, "double")).toBe(false);
  });

  it("ne propose que des chemins valides", () => {
    for (const outRule of ["single", "double", "master"] as const) {
      for (let v = 1; v <= 180; v++) {
        for (const route of suggestCheckouts(v, { outRule, limit: 5 })) {
          expect(route.darts.reduce((s, d) => s + dartScore(d), 0)).toBe(v);
          expect(route.darts.length).toBeLessThanOrEqual(3);
          expect(isFinishingDart(route.darts[route.darts.length - 1]!, outRule)).toBe(true);
        }
      }
    }
  });

  it("respecte le nombre de fléchettes restantes", () => {
    expect(suggestCheckouts(100, { outRule: "double", dartsLeft: 1 })).toEqual([]);
    expect(suggestCheckouts(60, { outRule: "double", dartsLeft: 1 })).toEqual([]);
    expect(suggestCheckouts(40, { outRule: "double", dartsLeft: 1 })[0]?.labels).toEqual(["D20"]);
    expect(suggestCheckouts(170, { outRule: "double", dartsLeft: 2 })).toEqual([]);
  });

  it("gère la simple sortie et la master sortie", () => {
    expect(suggestCheckouts(180, { outRule: "single" })[0]?.labels).toEqual(["T20", "T20", "T20"]);
    expect(suggestCheckouts(1, { outRule: "single" })[0]?.labels).toEqual(["S1"]);
    expect(suggestCheckouts(51, { outRule: "master" })[0]?.labels).toEqual(["T17"]);
    expect(canCheckout(1, "master")).toBe(false);
  });

  it("propose des alternatives et applique la stratégie", () => {
    const routes = suggestCheckouts(100, { outRule: "double", limit: 3 });
    expect(routes.length).toBe(3);
    expect(new Set(routes.map((r) => r.labels.join(" "))).size).toBe(3);
    expect(suggestCheckouts(60, { outRule: "double", strategy: "bull" })[0]?.labels).toEqual(["S10", "BULL"]);
    expect(suggestCheckouts(70, { outRule: "double" })[0]?.labels).toEqual(["T18", "D8"]);
    expect(suggestCheckouts(70, { outRule: "double", strategy: "double_favori", favoriteDouble: 20 })[0]?.labels).toEqual(["T10", "D20"]);
    // Le double favori ne fait jamais lancer une fléchette de plus.
    expect(suggestCheckouts(32, { outRule: "double", strategy: "double_favori", favoriteDouble: 8 })[0]?.labels).toEqual(["D16"]);
  });

  it("évalue le bust selon la règle de sortie", () => {
    const s20 = { segment: 20, multiplier: 1 as const };
    const d20 = { segment: 20, multiplier: 2 as const };
    const t20 = { segment: 20, multiplier: 3 as const };
    expect(evaluateOut(-1, s20, "single")).toBe("bust");
    expect(evaluateOut(0, s20, "single")).toBe("checkout");
    expect(evaluateOut(1, s20, "single")).toBe("continue");
    expect(evaluateOut(0, s20, "double")).toBe("bust");
    expect(evaluateOut(0, d20, "double")).toBe("checkout");
    expect(evaluateOut(1, s20, "double")).toBe("bust");
    expect(evaluateOut(0, t20, "master")).toBe("checkout");
    expect(evaluateOut(0, t20, "double")).toBe("bust");
  });
});
