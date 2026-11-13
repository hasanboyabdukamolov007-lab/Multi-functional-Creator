import { describe, expect, it } from "vitest";
import { createSchemaSql, diffSql, newColumn, newTable, starterSchema, validateSchema, type DbSchema } from "./sqlgen";
import { generateApi, plural, starterSpec, validateSpec } from "./apigen";
import { nextProject, staticSite, expoProject, zip } from "../builder/projectExport";
import { rnStyle } from "../builder/rnExport";
import { newDoc, newPage, n, DEFAULT_TOKENS } from "../builder/model";
import { unzipSync, strFromU8 } from "fflate";

describe("SQL generator", () => {
  it("creates tables in foreign-key order for both dialects", () => {
    const s = starterSchema();
    s.tables.reverse(); // orders before users
    expect(validateSchema(s)).toEqual([]);
    const pg = createSchemaSql(s);
    expect(pg.indexOf('CREATE TABLE "users"')).toBeLessThan(pg.indexOf('CREATE TABLE "orders"'));
    expect(pg).toContain('CONSTRAINT "fk_orders_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE');
    expect(pg).toContain("CREATE EXTENSION IF NOT EXISTS pgcrypto;");
    expect(pg).toContain('"email" varchar(254) NOT NULL UNIQUE');
    const my = createSchemaSql({ ...s, dialect: "mysql" });
    expect(my).toContain("`id` char(36) DEFAULT (uuid())"); // PRIMARY KEY implies NOT NULL
    expect(my).toContain("ENGINE=InnoDB");
    expect(my).toContain("`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)");
  });

  it("defers foreign keys in cycles and validates bad designs", () => {
    const a = newTable("a");
    const b = newTable("b");
    a.columns.push(newColumn({ name: "b_id", type: "uuid", references: { table: "b", column: "id", onDelete: "set null" } }));
    b.columns.push(newColumn({ name: "a_id", type: "uuid", references: { table: "a", column: "id", onDelete: "set null" } }));
    const sql = createSchemaSql({ version: 1, dialect: "postgres", tables: [a, b] });
    expect(sql).toMatch(/ALTER TABLE "\w" ADD CONSTRAINT/);
    const bad: DbSchema = { version: 1, dialect: "postgres", tables: [{ ...newTable("1bad"), columns: [newColumn({ name: "x", references: { table: "nope", column: "id", onDelete: "set null" }, nullable: false })] }] };
    const problems = validateSchema(bad).join(" | ");
    expect(problems).toMatch(/must start with a letter/);
    expect(problems).toMatch(/no primary key/);
    expect(problems).toMatch(/missing column/);
    expect(problems).toMatch(/SET NULL needs a nullable column/);
  });

  it("diffs designs into migrations, detecting renames by id", () => {
    const before = starterSchema();
    const after = structuredClone(before) as DbSchema;
    const users = after.tables.find((t) => t.name === "users")!;
    users.name = "customers";
    users.columns.find((c) => c.name === "name")!.name = "full_name";
    users.columns.push(newColumn({ name: "phone", type: "varchar", length: 20 }));
    const orders = after.tables.find((t) => t.name === "orders")!;
    orders.columns = orders.columns.filter((c) => c.name !== "status");
    orders.columns.find((c) => c.name === "total")!.nullable = true;
    after.tables.push(newTable("products"));
    const steps = diffSql(before.tables, after.tables, "postgres").join("\n");
    expect(steps).toContain('ALTER TABLE "users" RENAME TO "customers";');
    expect(steps).toContain('ALTER TABLE "customers" RENAME COLUMN "name" TO "full_name";');
    expect(steps).toContain('ALTER TABLE "customers" ADD COLUMN "phone" varchar(20);');
    expect(steps).toContain('ALTER TABLE "orders" DROP COLUMN "status";');
    expect(steps).toContain('ALTER TABLE "orders" ALTER COLUMN "total" DROP NOT NULL;');
    expect(steps).toContain('CREATE TABLE "products"');
    expect(diffSql(before.tables, before.tables, "postgres")).toEqual([]);
  });
});

describe("API generator", () => {
  it("validates specs and generates a complete project", () => {
    const spec = starterSpec();
    expect(validateSpec(spec)).toEqual([]);
    const files = generateApi(spec);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["package.json", "src/server.ts", "src/routes/products.ts", "src/routes/orders.ts", "migrations/001_init.sql", "openapi.json", "Dockerfile", "README.md", ".env.example"]));
    expect(files["migrations/001_init.sql"]).toContain("sku varchar(255) NOT NULL UNIQUE");
    expect(files["src/routes/orders.ts"]).toContain('app.addHook("onRequest", requireAuth)');
    expect(files["src/routes/products.ts"]).not.toContain("requireAuth");
    expect(JSON.parse(files["openapi.json"]).paths["/orders/{id}"].patch).toBeTruthy();
    expect(files[".env.example"]).toContain("API_KEY=");
    expect(plural("category")).toBe("categories");
    expect(plural("box")).toBe("boxes");
    const bad = { ...spec, resources: [{ ...spec.resources[0], name: "Bad Name", fields: [{ ...spec.resources[0].fields[0], name: "id" }] }] };
    expect(validateSpec(bad).join(" ")).toMatch(/snake_case.*added automatically/);
  });
});

describe("project exporters", () => {
  const doc = newDoc();
  doc.pages[0].root.children = [n("hero", {}), n("button", { text: "Go", href: "/about" })];
  const about = newPage("About us", "/about");
  about.root.children = [n("heading", { text: "About", level: 1 }), n("image", { src: "https://example.com/a.png", alt: "Team" })];
  doc.pages.push(about);

  it("exports a static multi-page site with a shared stylesheet", () => {
    const f = staticSite(doc, "Acme");
    expect(f["index.html"]).toContain('<link rel="stylesheet" href="site.css" />');
    expect(f["about/index.html"]).toContain('<link rel="stylesheet" href="../site.css" />');
    expect(f["site.css"]).toContain("--color-primary");
  });

  it("exports a Next.js app with one route per page", () => {
    const f = nextProject(doc, "Acme");
    expect(f["app/page.tsx"]).toContain("export default function HomePage()");
    expect(f["app/about/page.tsx"]).toContain("export default function AboutUsPage()");
    expect(f["app/layout.tsx"]).toContain('<body className="site">');
  });

  it("exports an Expo app with native components", () => {
    const f = expoProject(doc, "Acme");
    expect(f["app/index.tsx"]).toContain("<Pressable");
    expect(f["app/index.tsx"]).toContain('router.push("/about")');
    expect(f["app/about.tsx"]).toContain('<Image source={{ uri: "https://example.com/a.png" }}');
    expect(f["app/about.tsx"]).toContain('accessibilityRole="header"');
    expect(rnStyle({ padding: "16px 24px", background: "var(--color-primary)", fontSize: "1.5rem", width: "calc(100% - 2px)" }, DEFAULT_TOKENS)).toEqual({ paddingTop: 16, paddingRight: 24, paddingBottom: 16, paddingLeft: 24, backgroundColor: DEFAULT_TOKENS.primary, fontSize: 24 });
  });

  it("zips files under a root folder", () => {
    const z = unzipSync(zip({ "a.txt": "hello", "b/c.txt": "world" }, "proj"));
    expect(Object.keys(z).sort()).toEqual(["proj/a.txt", "proj/b/c.txt"]);
    expect(strFromU8(z["proj/b/c.txt"])).toBe("world");
  });
});
