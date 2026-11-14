import { describe, expect, it } from "vitest";
import { registerAllFunctions } from "./functions";
import { registry } from "./lib/registry";
import { KB, search } from "./modules/copilot/brain/knowledge";

describe("function registry", () => {
  it("registers every panel function once, with unique ids", () => {
    expect(() => registerAllFunctions()).not.toThrow();
    const ids = registry.list().map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(500);
    expect(ids).toEqual(expect.arrayContaining(["billing.open", "devices.open", "devices.push.enable", "app.install"]));
  });

  it("every knowledge-base lesson's \"try it\" function exists", () => {
    registerAllFunctions();
    const missing = KB.filter((e) => e.tryFn && !registry.get(e.tryFn)).map((e) => `${e.id} → ${e.tryFn}`);
    expect(missing).toEqual([]);
  });

  it("Forge finds the platform topics in all three languages", () => {
    const top = (q: string) => search(q, {}, 1)[0]?.entry.id;
    expect(top("how do push notifications work")).toBe("push-notifications");
    expect(top("verify stripe webhook signature")).toBe("webhook-security");
    expect(top("tauri or electron for a desktop app")).toBe("desktop-apps");
    expect(top("obuna va tarif to‘lovi qanday ishlaydi")).toBe("saas-billing");
    expect(top("плагин песочница iframe")).toBe("plugin-sandbox");
    expect(top("magic link with one-time code")).toBe("passwordless-auth");
  });
});
