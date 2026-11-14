import { describe, expect, it } from "vitest";
import { bezierAt, EASES, STARTER, sample, toCss, toWaapi, valueAt } from "./timeline";
import { pageHtml } from "../builder/exporters";
import { newDoc, n } from "../builder/model";
import { buildModel, LIBRARY } from "../studio/library";

describe("motion timeline", () => {
  it("evaluates cubic-bezier easing like CSS", () => {
    expect(bezierAt(EASES.linear, 0.37)).toBeCloseTo(0.37, 3);
    expect(bezierAt(EASES.ease, 0.5)).toBeCloseTo(0.8024, 2); // CSS 'ease' at x=0.5
    expect(bezierAt(EASES.overshoot, 0.6)).toBeGreaterThan(1); // overshoots
    expect(bezierAt(EASES["ease-in"], 0)).toBe(0);
    expect(bezierAt(EASES["ease-in"], 1)).toBe(1);
  });
  it("interpolates tracks and exports CSS + WAAPI", () => {
    expect(valueAt(STARTER.tracks.rotate, 1, "rotate")).toBe(360);
    expect(sample(STARTER, 0).x).toBe(-160);
    const css = toCss(STARTER, "spin");
    expect(css).toContain("@keyframes spin");
    expect(css).toContain("0% { transform: translate(-160px, 0px)");
    expect(css).toContain("prefers-reduced-motion");
    expect(toWaapi(STARTER)).toContain("el.animate(");
  });
  it("exports builder motion presets with a scroll-reveal script only when needed", () => {
    const doc = newDoc();
    doc.pages[0].root.children = [{ ...n("heading", { text: "Hi" }), props: { text: "Hi", level: 1, _motion: "in-fade-up" } }];
    const html = pageHtml(doc, doc.pages[0]);
    expect(html).toContain('data-motion="in-fade-up"');
    expect(html).toContain("IntersectionObserver");
    doc.pages[0].root.children = [{ ...n("button", { text: "Go" }), props: { text: "Go", _motion: "hover-lift" } }];
    const h2 = pageHtml(doc, doc.pages[0]);
    expect(h2).toContain('data-motion="hover-lift"');
    expect(h2).not.toContain("IntersectionObserver");
  });
  it("builds every 3D library model as a group of parts", () => {
    for (const id of Object.keys(LIBRARY)) {
      const objs = buildModel(id);
      expect(objs[0].kind).toBe("group");
      expect(objs.slice(1).every((o) => o.parentId === objs[0].id && o.kind === "mesh")).toBe(true);
    }
  });
});
