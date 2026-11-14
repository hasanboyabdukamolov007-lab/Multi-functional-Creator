import { describe, expect, it } from "vitest";
import { registerAllFunctions } from "./functions";
import { registry } from "./lib/registry";

describe("function registry", () => {
  it("registers every panel function once, with unique ids", () => {
    expect(() => registerAllFunctions()).not.toThrow();
    const ids = registry.list().map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(500);
    expect(ids).toEqual(expect.arrayContaining(["billing.open", "devices.open", "devices.push.enable", "app.install"]));
  });
});
