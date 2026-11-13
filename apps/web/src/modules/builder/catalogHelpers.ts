import { h, type Spec } from "./spec";
import { SITE_ICONS } from "./icons";
import type { PropField } from "./catalog";

export const F = {
  text: (key: string, label = key): PropField => ({ key, label, kind: "text" }),
  area: (key: string, label = key): PropField => ({ key, label, kind: "textarea" }),
  lines: (key: string, label: string, hint: string): PropField => ({ key, label, kind: "lines", hint }),
  num: (key: string, label = key): PropField => ({ key, label, kind: "number" }),
  sel: (key: string, label: string, options: string[]): PropField => ({ key, label, kind: "select", options }),
  bool: (key: string, label = key): PropField => ({ key, label, kind: "boolean" }),
  url: (key: string, label = key): PropField => ({ key, label, kind: "url" }),
};

export const btn = (text: string, href: string, variant = "primary", extra: Record<string, any> = {}): Spec =>
  href ? h("a", { class: `btn btn-${variant}`, href, ...extra }, text) : h("button", { class: `btn btn-${variant}`, type: "button", ...extra }, text);

export const svgIcon = (name: string, size = 24): Spec =>
  h(
    "svg",
    { viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" },
    h("path", { d: SITE_ICONS[name] ?? SITE_ICONS.star }),
  );

export const labelled = (label: string, control: Spec): Spec => h("label", { class: "field" }, ...(label ? [h("span", { class: "field-label" }, label)] : []), control);

