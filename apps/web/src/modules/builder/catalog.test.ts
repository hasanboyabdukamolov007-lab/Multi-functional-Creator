import { describe, expect, it } from "vitest";
import { CATALOG } from "./catalog";
import { n } from "./model";
import { nodeHtml, nodeJsx } from "./exporters";

describe("component catalog", () => {
  it("has 100+ palette components with unique types", () => {
    const palette = CATALOG.filter((c) => c.type !== "page");
    expect(palette.length).toBeGreaterThanOrEqual(100);
    expect(new Set(CATALOG.map((c) => c.type)).size).toBe(CATALOG.length);
  });

  it("renders every component to HTML and JSX with its defaults", () => {
    for (const c of CATALOG) {
      const node = n(c.type, structuredClone(c.defaults), c.container ? [n("text", { text: "child" })] : []);
      const html = nodeHtml(node);
      const jsx = nodeJsx(node);
      expect(html.length, c.type).toBeGreaterThan(5);
      expect(jsx.length, c.type).toBeGreaterThan(5);
      if (c.container) expect(html, c.type).toContain("child");
      expect(html, c.type).not.toContain("undefined");
      expect(html, c.type).not.toContain("[object Object]");
    }
  });
});
