import { describe, expect, it } from "vitest";
import { randomExample } from "../examples";
import { parseRequest } from "../parse";
import { plan } from "../plan";

const TODAY = "2026-10-21";

// Small seeded generator so failures can be replayed.
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

describe("randomExample", () => {
  for (const lang of ["en", "fr", "ar"]) {
    it(`writes ${lang} requests the parser reads in full and that plan at a profit`, () => {
      for (let seed = 1; seed <= 150; seed++) {
        const text = randomExample(lang, TODAY, mulberry32(seed));
        const { request, missing } = parseRequest(text, TODAY);
        const where = `seed ${seed}: ${text}`;
        expect(missing, where).toEqual([]);
        expect(request.origin, where).not.toBe(request.destination);
        expect(request.deadline > TODAY, where).toBe(true);
        expect(request.price?.amount, where).toBeGreaterThan(0);
        expect(request.client, where).not.toBe("");
        expect(request.commodity, where).not.toBe("");
        const { matrix } = plan(request, TODAY);
        const a = matrix.options[0].profit_margin;
        expect(a.client_revenue, where).toBeGreaterThan(a.carrier_freight_cost + a.container_rent_fee + a.port_fees);
      }
    });
  }

  it("varies between clicks", () => {
    const texts = new Set(Array.from({ length: 10 }, () => randomExample("en", TODAY)));
    expect(texts.size).toBeGreaterThan(5);
  });
});
