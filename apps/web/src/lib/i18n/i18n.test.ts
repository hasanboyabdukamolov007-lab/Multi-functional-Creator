import { describe, expect, it } from "vitest";
import { en } from "./en";
import { uz } from "./uz";
import { ru } from "./ru";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

describe("translations", () => {
  for (const [name, dict] of [["uz", uz], ["ru", ru]] as const) {
    it(`${name} translates every English key`, () => {
      const missing = Object.keys(en).filter((k) => !(k in dict));
      expect(missing).toEqual([]);
    });
    it(`${name} keeps every {placeholder}`, () => {
      const broken = Object.entries(dict).filter(([k, v]) => k in en && placeholders(v as string) !== placeholders((en as Record<string, string>)[k]));
      expect(broken.map(([k]) => k)).toEqual([]);
    });
  }
});
