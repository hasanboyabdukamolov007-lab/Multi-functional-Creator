/**
 * Understands requests for backends and databases in English, Uzbek and Russian:
 *   "create an API for products with name, price and stock, and customers with name, email"
 *   "mahsulotlar uchun API yarat: nomi, narxi"
 *   "создай базу данных для пациентов с полями имя, телефон"
 * Pure: returns a plan the engine executes with the data module's functions.
 */
import * as L from "./lexicon";

export interface DataIntent {
  kind: "dataGen";
  target: "api" | "schema" | "both";
  auth: "none" | "apiKey" | "jwt" | null;
  resources: Array<{ name: string; fields: string[] }>;
}

const API_WORDS = ["api$", "apis$", "backend", "crud", "rest$", "restful", "endpoint", "бэкенд", "бекенд", "апи$", "server side"];
const DB_WORDS = ["database", "db$", "schema", "sql$", "postgres", "mysql", "ma'lumotlar baza", "baza", "база данных", "базу данных", "бд$", "схему бд", "схема бд", "схему базы"];

/** Resource words → canonical singular snake_case names. */
const RESOURCES: Record<string, string[]> = {
  product: ["product", "goods", "mahsulot", "tovar", "товар", "продукт"],
  user: ["user", "account", "foydalanuvchi", "пользовател", "аккаунт"],
  order: ["order", "buyurtma", "заказ"],
  customer: ["customer", "client", "mijoz", "клиент", "покупател"],
  post: ["post$", "posts$", "article", "maqola", "пост", "стат"],
  comment: ["comment", "izoh", "коммент"],
  task: ["task", "todo", "vazifa", "задач"],
  project: ["project", "loyiha", "проект"],
  category: ["categor", "kategoriya", "toifa", "категори"],
  patient: ["patient", "bemor", "пациент"],
  doctor: ["doctor", "shifokor", "врач", "доктор"],
  appointment: ["appointment", "booking", "reservation", "qabul", "bron", "запис", "бронир"],
  book: ["book", "kitob", "книг"],
  author: ["author", "muallif", "автор"],
  student: ["student", "talaba", "o'quvchi", "студент", "ученик"],
  course: ["course", "kurs", "курс"],
  teacher: ["teacher", "o'qituvchi", "учител", "преподав"],
  employee: ["employee", "staff", "xodim", "сотрудник", "работник"],
  invoice: ["invoice", "hisob-faktura", "счет", "счёт", "инвойс"],
  payment: ["payment", "to'lov", "платеж", "платёж", "оплат"],
  event: ["event", "tadbir", "событи", "мероприят"],
  message: ["message", "xabar", "сообщени"],
  review: ["review", "sharh", "отзыв"],
  ticket: ["ticket", "chipta", "тикет", "билет"],
  room: ["room", "xona", "номер", "комнат"],
  car: ["car$", "cars$", "vehicle", "mashina", "avtomobil", "машин", "автомобил"],
  property: ["propert", "listing", "uy-joy", "недвижим", "объект"],
  lead: ["lead$", "leads$", "лид"],
  note: ["note$", "notes$", "eslatma", "заметк"],
};

/** Field words → canonical names (only needed for non-English words; English words pass through). */
const FIELDS: Record<string, string[]> = {
  name: ["nom", "ism", "назван", "имя", "имени", "наименован"],
  title: ["sarlavha", "заголов"],
  description: ["tavsif", "описан"],
  price: ["narx", "цен", "стоимост"],
  stock: ["qoldiq", "остат", "запас"],
  quantity: ["miqdor", "soni", "количеств"],
  email: ["pochta", "почт", "e-mail", "емейл", "имейл"],
  phone: ["telefon", "телефон"],
  address: ["manzil", "адрес"],
  status: ["holat", "статус"],
  date: ["sana", "дат"],
  body: ["matn", "текст"],
  rating: ["reyting", "baho", "рейтинг", "оценк"],
  image_url: ["rasm", "foto", "фото", "картин", "изображен"],
  age: ["yosh", "возраст"],
  total: ["jami", "summa", "сумм", "итог"],
  password: ["parol", "парол"],
  is_active: ["faol", "активн"],
  due_date: ["muddat", "срок"],
};

const SPLIT = new Set(["with", "having", "fields", "field", "columns", "column", "bilan", "maydon", "maydonlar", "maydonlari", "ustun", "ustunlar", "с", "со", "поля", "полями", "полем", "колонк", "колонками", "столбцами"]);
const SKIP = new Set(["and", "or", "a", "an", "the", "for", "of", "to", "va", "hamda", "uchun", "и", "для", "или", "a", "plus", "also", "its", "their", "each", "every", "some", "new", "simple", "full", "complete", "rest", "api", "crud", "backend", "database", "db", "schema", "table", "tables", "create", "make", "build", "generate", "me", "please", "with", "yarat", "qur", "tuz", "создай", "сделай", "сгенерируй", "построй", "auth", "jwt", "key", "keys", "app", "apps", "application", "service", "system", "platform", "my", "our", "ilova", "tizim", "xizmat", "приложение", "приложения", "сервис", "систему", "система", "мой", "моего", "нашего"]);

const translit: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ы: "y", э: "e", ю: "yu", я: "ya", ь: "", ъ: "" };
const ident = (s: string) =>
  s
    .toLowerCase()
    .split("")
    .map((c) => translit[c] ?? c)
    .join("")
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

function lookup(lex: Record<string, string[]>, token: string): string | null {
  for (const [key, stems] of Object.entries(lex)) if (stems.some((s) => (s.endsWith("$") ? token === s.slice(0, -1) : token.startsWith(s)))) return key;
  return null;
}
const singular = (w: string) => (/ies$/.test(w) ? `${w.slice(0, -3)}y` : /(ses|xes|ches|shes)$/.test(w) ? w.slice(0, -2) : /s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w);

export function parseDataIntent(clause: string): DataIntent | null {
  const text = L.normalize(clause);
  const tokens = text.split(/[^\p{L}\p{N}_'-]+/u).filter(Boolean);
  const has = (stems: string[]) => L.hasAny(text, tokens, stems);
  const api = has(API_WORDS);
  const db = has(DB_WORDS);
  if (!api && !db) return null;
  if (!has(L.INTENT_WORDS.create)) return null;
  // "a landing page for my API product" is a page, not a backend.
  if (/(^|\s)(site|website|page|landing|sayt|sahifa|сайт|страниц\S*|лендинг)(\s|$)/.test(text) && !has(["backend", "crud", "endpoint", "бэкенд", "бекенд"])) return null;

  const resources: Array<{ name: string; fields: string[] }> = [];
  const loose: string[] = [];
  let current: { name: string; fields: string[] } | null = null;
  let collecting = false;
  // "orders with total and product": a trailing resource word without fields is a reference.
  const implicit = new Map<{ name: string; fields: string[] }, { name: string; fields: string[] }>();
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (SPLIT.has(tok)) {
      collecting = true;
      continue;
    }
    const nextIsWith = SPLIT.has(tokens[i + 1] ?? "");
    const res = lookup(RESOURCES, tok);
    // A resource is a known resource word, or (English) any word right before "with".
    if ((res && !(collecting && current && lookup(FIELDS, tok))) || (nextIsWith && /^[a-z][a-z_]+$/.test(tok) && !SKIP.has(tok))) {
      if (collecting && current && !nextIsWith && !res) {
        current.fields.push(tok);
        continue;
      }
      if (collecting && current && res && !nextIsWith && current.fields.length && tokens[i - 1] !== "and" && tokens[i - 1] !== "va" && tokens[i - 1] !== "и") {
        // "user with name, product id" — a resource word used as a field ("product_id")
        current.fields.push(`${res}_id`);
        continue;
      }
      const parent = collecting && current && current.fields.length && !nextIsWith ? current : null;
      current = { name: res ?? singular(tok), fields: [] };
      if (parent) implicit.set(current, parent);
      if (!resources.some((r) => r.name === current!.name)) resources.push(current);
      else current = resources.find((r) => r.name === current!.name)!;
      collecting = false;
      continue;
    }
    if (SKIP.has(tok) || L.hasAny(tok, [tok], [...L.INTENT_WORDS.create, ...API_WORDS, ...DB_WORDS])) continue;
    const field = lookup(FIELDS, tok) ?? (/^[a-z][a-z0-9_]*$/.test(tok) ? tok : null);
    if (collecting && current) current.fields.push(field ?? ident(tok));
    else if (lookup(FIELDS, tok)) loose.push(lookup(FIELDS, tok)!);
  }
  for (const [r, parent] of implicit)
    if (!r.fields.length && resources.indexOf(r) >= 0) {
      resources.splice(resources.indexOf(r), 1);
      parent.fields.push(`${r.name}_id`);
    }
  if (!resources.length) resources.push({ name: "item", fields: [] });
  // Uzbek word order puts the fields before the resource: "nomi, narxi bilan mahsulotlar".
  if (loose.length && resources.length === 1 && !resources[0].fields.length) resources[0].fields = loose;
  for (const r of resources) {
    r.fields = [...new Set(r.fields.map(ident).filter((f) => f && !["id", "created_at", "updated_at"].includes(f)))];
    if (!r.fields.length) r.fields = r.name === "user" || r.name === "customer" ? ["name", "email"] : ["name", "description"];
  }
  const auth = /\bjwt\b|token/.test(text) ? "jwt" : /api[ -]?key|kalit|ключ/.test(text) ? "apiKey" : /public|no auth|ochiq|без авториз|публичн/.test(text) ? "none" : null;
  return { kind: "dataGen", target: api && db ? "both" : api ? "api" : "schema", auth, resources };
}
