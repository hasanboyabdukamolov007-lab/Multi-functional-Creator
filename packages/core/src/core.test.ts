import { describe, expect, it } from "vitest";
import { scanForLeaks, parseDotenv, serializeDotenv, can, FunctionRegistry, validateArgs } from "./index.js";

describe("leak scanner", () => {
  it("finds provider keys and never returns the full secret", () => {
    const key = "sk-ant-api03-" + "a".repeat(40);
    const src = `const client = new Anthropic({ apiKey: "${key}" });\nconst gh = "ghp_${"B".repeat(36)}";`;
    const f = scanForLeaks(src);
    expect(f.map((x) => x.ruleId)).toEqual(["anthropic-key", "github-token"]);
    expect(f[0].line).toBe(1);
    expect(f[1].line).toBe(2);
    for (const x of f) expect(src.includes(x.preview)).toBe(false);
  });

  it("detects db url passwords and generic assignments but skips placeholders and env refs", () => {
    const src = [
      `DATABASE_URL=postgres://app:superSecretPass1@db:5432/app`,
      `const password = "hunter2hunter2hunter2";`,
      `const apiKey = "your-api-key-here";`,
      `const token = process.env.TOKEN;`,
    ].join("\n");
    const ids = scanForLeaks(src).map((x) => x.ruleId);
    expect(ids).toEqual(["db-url-password", "generic-assignment"]);
  });

  it("does not double-report a specific key through the generic rule", () => {
    const src = `api_key = "AKIAABCDEFGHIJKLMNOP"`;
    expect(scanForLeaks(src).map((x) => x.ruleId)).toEqual(["aws-access-key"]);
  });
});

describe("dotenv", () => {
  it("round-trips quoting, comments, export prefix and multi-line values", () => {
    const input = `# comment\nexport A=1\nB="hello world" # trailing\nC='single # not comment'\nD="line1\\nline2"\nE=plain # c\nF="multi\nline"\n`;
    const { entries, errors } = parseDotenv(input);
    expect(errors).toEqual([]);
    expect(Object.fromEntries(entries.map((e) => [e.key, e.value]))).toEqual({
      A: "1",
      B: "hello world",
      C: "single # not comment",
      D: "line1\nline2",
      E: "plain",
      F: "multi\nline",
    });
    const again = parseDotenv(serializeDotenv(entries)).entries;
    expect(again).toEqual(entries);
  });

  it("reports bad lines", () => {
    expect(parseDotenv("NOEQUALS\n1BAD=x").errors.length).toBe(2);
  });
});

describe("access", () => {
  it("applies the role matrix", () => {
    expect(can("owner", "workspace.manage")).toBe(true);
    expect(can("admin", "workspace.manage")).toBe(false);
    expect(can("editor", "secrets.reveal")).toBe(true);
    expect(can("editor", "secrets.export")).toBe(false);
    expect(can("viewer", "secrets.reveal")).toBe(false);
  });
});

describe("function registry", () => {
  it("registers, searches, validates and runs", async () => {
    const r = new FunctionRegistry<{ n: number }>();
    r.register([
      { id: "math.add", title: "Add number", category: "Math", params: { type: "object", properties: { x: { type: "number" } }, required: ["x"] }, run: (a, c) => c.n + (a.x as number) },
      { id: "math.reset", title: "Reset", category: "Math", when: (c) => (c.n > 0 ? true : "Nothing to reset"), run: () => 0 },
    ]);
    expect(r.size).toBe(2);
    expect(r.search("add")[0].id).toBe("math.add");
    await expect(r.run("math.add", {}, { n: 1 })).rejects.toThrow(/x is required/);
    expect(await r.run("math.add", { x: 2 }, { n: 1 })).toBe(3);
    await expect(r.run("math.reset", {}, { n: 0 })).rejects.toThrow(/Nothing to reset/);
    expect(() => r.register({ id: "math.add", title: "dup", category: "x", run: () => 0 })).toThrow(/Duplicate/);
  });

  it("validates enums and integer types", () => {
    expect(validateArgs({ type: "object", properties: { m: { enum: ["a", "b"] }, i: { type: "integer" } } }, { m: "c", i: 1.5 })).toHaveLength(2);
  });
});
