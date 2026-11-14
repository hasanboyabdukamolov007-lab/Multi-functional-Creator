/**
 * Multilingual vocabulary for Forge's built-in engine (English, Uzbek, Russian).
 * Entries are word stems: a token matches when it starts with the stem (stems ending in "$" must match exactly).
 * Russian and Uzbek are inflected, so stems keep matching across case endings.
 */

export type Lang = "en" | "uz" | "ru";
export type Lex = Record<string, string[]>;

export const INTENT_WORDS = {
  create: ["create", "make", "build", "generate", "design", "new$", "start", "set up", "yarat", "qur", "tuz", "yasa", "ishla", "chiz", "созда", "сдела", "построй", "построить", "сгенер", "нов", "разработ", "нарисуй"],
  add: ["add", "insert", "put", "append", "include", "place", "qo'sh", "qosh", "joyla", "kirit", "добав", "встав", "помест", "размест"],
  remove: ["remove", "delete", "drop", "clear", "erase", "o'chir", "ochir", "olib tashla", "удал", "убер", "очист", "сотри"],
  change: ["make", "change", "set", "turn", "use", "apply", "paint", "color", "colour", "switch", "o'zgartir", "ozgartir", "qil$", "qiling", "bo'yа", "bo'ya", "boya", "сдела", "измени", "поменя", "установ", "покрас", "примени", "переключ"],
  open: ["open", "go to", "goto", "show", "navigate", "take me", "och", "ko'rsat", "korsat", "o't", "открой", "открыть", "перейди", "покажи", "перейти"],
  animate: ["animate", "animation", "spin", "rotate", "turn around", "bounce", "float", "pulse", "fade", "pop", "jonlantir", "animatsiya", "aylan", "sakra", "анимир", "анимац", "вращ", "крути", "прыг", "подпры"],
  help: ["help", "what can you", "how do i", "how to", "capabilit", "commands", "yordam", "nima qila", "qanday", "помощ", "помоги", "что ты умеешь", "как "],
  undo: ["undo", "revert", "orqaga qaytar", "bekor qil", "отмени", "отмена"],
  redo: ["redo", "qayta bajar", "повтори", "вернуть"],
  export: ["export", "download", "eksport", "yuklab ol", "экспорт", "скача", "выгруз"],
  audit: ["audit", "check", "review", "expir", "rotate", "tekshir", "muddat", "провер", "аудит", "истека"],
  scan: ["scan", "leak", "skaner", "skanerla", "сканир", "утечк"],
  save: ["save", "saqla", "сохран"],
  status: ["status", "what is open", "where am i", "holat", "статус", "что открыто"],
  language: ["language", "til$", "tilni", "язык"],
  theme: ["theme", "mavzu", "тем"],
  dark: ["dark", "night", "qorong'i", "qorongi", "tun", "тёмн", "темн", "ночн"],
  light: ["light", "bright", "day", "yorug'", "yorug", "kunduzgi", "светл", "дневн"],
  palette: ["palette", "colors", "colours", "color scheme", "brand", "ranglar", "rang", "палитр", "цвета", "бренд"],
  bigger: ["bigger", "larger", "increase", "kattaroq", "kattalashtir", "больше", "крупнее", "увелич"],
  smaller: ["smaller", "decrease", "kichikroq", "kichraytir", "меньше", "уменьш"],
  center: ["center", "centre", "middle", "o'rtaga", "markaz", "по центру", "центр"],
  left: ["left", "chap", "слева", "влево", "левый"],
  right: ["right", "o'ng", "справа", "вправо", "правый"],
  bold: ["bold", "qalin", "жирн"],
  rounded: ["round", "rounded", "yumaloq", "скругл", "кругл"],
  shadow: ["shadow", "soya", "тень", "тени"],
  hide: ["hide", "invisible", "yashir", "скрой", "спрячь"],
  uppercase: ["uppercase", "capital", "katta harf", "заглавн"],
  spacing: ["spacing", "padding", "space", "bo'shliq", "отступ"],
  without: ["without", "no$", "except", "siz$", "-siz", "без"],
  with: ["with", "including", "bilan", "с$", "со$", "включ"],
} satisfies Lex;

export const PAGE_TYPES: Lex = {
  landing: ["landing", "homepage", "home page", "website", "site", "lending", "sayt", "сайт", "лендинг", "посадочн"],
  portfolio: ["portfolio", "personal site", "resume", "cv$", "portfolio", "rezyume", "портфолио", "резюме"],
  dashboard: ["dashboard", "admin", "panel", "crm", "analytics", "boshqaruv", "панел", "админ", "дашборд", "аналитик"],
  shop: ["shop", "store", "e-commerce", "ecommerce", "products", "do'kon", "dokon", "магазин", "интернет-магазин", "товар"],
  blog: ["blog", "article", "news", "maqola", "yangilik", "блог", "стать", "новост"],
  pricing: ["pricing page", "plans page", "narxlar sahifa", "страница цен", "тарифы"],
  contact: ["contact page", "aloqa sahifa", "страница контакт"],
  comingSoon: ["coming soon", "waitlist", "launch page", "tez orada", "скоро", "лист ожидания"],
  mobile: ["mobile app", "app screen", "mobil ilova", "мобильн"],
};

/** Page sections that can be requested or excluded ("with pricing", "without faq"). */
export const SECTIONS: Lex = {
  pricing: ["pricing", "price", "plans", "tariff", "narx", "tarif", "цен", "тариф", "прайс"],
  faq: ["faq", "questions", "savol", "вопрос", "чаво"],
  testimonials: ["testimonial", "reviews", "feedback", "fikr", "sharh", "отзыв"],
  contact: ["contact", "form", "aloqa", "bog'lan", "контакт", "связ", "форм"],
  features: ["features", "benefits", "services", "imkoniyat", "afzallik", "xizmat", "возможност", "преимуществ", "услуг"],
  stats: ["stats", "numbers", "statistic", "raqam", "statistika", "статист", "цифр"],
  team: ["team", "jamoa", "команд"],
  gallery: ["gallery", "photos", "galereya", "rasmlar", "галере", "фото"],
  logos: ["logos", "clients", "partners", "mijoz", "hamkor", "клиент", "партнер", "партнёр"],
  newsletter: ["newsletter", "subscribe", "obuna", "подписк", "рассылк"],
  cta: ["call to action", "cta"],
};

/** Builder components addressable by name (maps to catalog types). */
export const COMPONENTS: Lex = {
  hero: ["hero", "banner", "header section", "bosh qism", "баннер", "герой", "шапк"],
  navbar: ["navbar", "navigation", "menu", "nav$", "menyu", "навигац", "меню"],
  footer: ["footer", "pastki qism", "подвал", "футер"],
  heading: ["heading", "title", "headline", "sarlavha", "заголов"],
  text: ["paragraph", "text", "matn", "абзац", "текст"],
  button: ["button", "btn", "tugma", "кнопк"],
  image: ["image", "picture", "photo", "img$", "rasm", "surat", "изображ", "картин", "фото"],
  video: ["video", "видео"],
  form: ["form$", "forma", "форма"],
  input: ["input", "field", "maydon", "поле", "инпут"],
  table: ["table", "jadval", "таблиц"],
  chart: ["chart", "graph", "diagramma", "grafik", "график", "диаграм"],
  stat: ["kpi", "stat card", "metric", "metrika", "метрик", "показател"],
  card: ["card", "karta", "kartochka", "карточк"],
  pricing: ["pricing", "narx", "цен", "тариф"],
  faq: ["faq", "savol", "вопрос"],
  testimonial: ["testimonial", "review", "fikr", "отзыв"],
  features: ["feature", "imkoniyat", "возможност"],
  cta: ["call to action", "cta"],
  contact: ["contact form", "contact", "aloqa", "контакт"],
  statsband: ["stats band", "statistics", "statistika", "статистик"],
  logos: ["logo cloud", "logos", "logotip", "логотип"],
  alert: ["alert", "notice", "ogohlantirish", "предупрежд", "уведомлен"],
  divider: ["divider", "separator", "ajratuvchi", "разделит"],
  spacer: ["spacer", "gap$", "bo'sh joy", "пробел", "отступ"],
  list: ["list", "ro'yxat", "royxat", "список"],
  quote: ["quote", "iqtibos", "цитат"],
  code: ["code block", "kod bloki", "блок кода"],
  embed: ["map", "embed", "xarita", "карт"],
  section: ["section", "bo'lim", "bolim", "секци", "раздел"],
  grid: ["grid", "setka", "сетк"],
  badge: ["badge", "tag$", "nishon", "бейдж", "метк"],
  progress: ["progress", "jarayon", "прогресс"],
  avatar: ["avatar", "аватар"],
  breadcrumb: ["breadcrumb", "хлебн"],
  tabs: ["tabs", "tab$", "vkladka", "вкладк"],
};

export const SHAPES: Lex = {
  sphere: ["sphere", "ball", "orb", "globe", "shar", "sfera", "сфер", "шар"],
  box: ["cube", "box", "block", "kub", "quti", "куб", "коробк", "блок"],
  cylinder: ["cylinder", "pillar", "column", "silindr", "ustun", "цилиндр", "колонн"],
  cone: ["cone", "konus", "конус"],
  torus: ["torus", "donut", "doughnut", "ring", "halqa", "uzuk", "тор", "кольц", "бублик"],
  torusKnot: ["knot", "tugun", "узел", "узл"],
  capsule: ["capsule", "pill", "kapsula", "капсул"],
  icosahedron: ["gem", "crystal", "icosa", "diamond", "kristall", "olmos", "кристал", "алмаз", "самоцвет"],
  tetrahedron: ["pyramid", "tetra", "piramida", "пирамид"],
  octahedron: ["octahedron", "октаэдр"],
  dodecahedron: ["dodecahedron", "додекаэдр"],
  plane: ["plane", "floor", "ground", "tekislik", "pol$", "плоскост", "пол$", "земл"],
  "shape-star": ["star", "yulduz", "звезд"],
  "shape-heart": ["heart", "yurak", "сердц", "сердечк"],
  "shape-hexagon": ["hexagon", "olti burchak", "шестиугол"],
  "shape-gear": ["gear", "cog", "shesterna", "tishli", "шестерн"],
  "shape-arrow": ["arrow", "strelka", "o'q", "стрелк"],
  "shape-roundedRect": ["tile", "plate", "card shape", "plitka", "плитк"],
};

export const LIGHTS: Lex = {
  "three-point": ["three-point", "three point", "studio light", "uch nuqtali", "трёхточ", "трехточ"],
  softbox: ["softbox", "soft light", "yumshoq yorug'lik", "мягкий свет"],
  sunset: ["golden hour", "sunset", "quyosh botishi", "закат"],
  spot: ["spotlight", "spot light", "прожектор"],
  point: ["point light", "lamp", "chiroq", "лампа", "лампочк"],
};

export const ENVIRONMENTS: Lex = {
  studio: ["studio", "studiya", "студи"],
  sunset: ["sunset", "evening", "quyosh botish", "kechqurun", "закат", "вечер"],
  night: ["night", "space", "tun", "kosmos", "ночь", "ночн", "космос"],
  warehouse: ["warehouse", "industrial", "ombor", "склад", "индустр"],
};

export const MATERIALS: Lex = {
  gold: ["gold", "golden", "oltin", "tilla", "золот"],
  silver: ["silver", "kumush", "серебр"],
  copper: ["copper", "mis$", "медн", "медь"],
  bronze: ["bronze", "bronza", "бронз"],
  chrome: ["chrome", "mirror", "xrom", "ko'zgu", "хром", "зеркал"],
  brushedSteel: ["steel", "metal", "po'lat", "metall", "стал", "металл"],
  glass: ["glass", "transparent", "shisha", "oyna", "стекл", "прозрачн"],
  frostedGlass: ["frosted", "matte glass", "xira shisha", "матов"],
  glossyPlastic: ["glossy", "shiny", "plastic", "yaltiroq", "plastik", "глянц", "блестящ", "пластик"],
  mattePlastic: ["matte", "mat$", "матовый"],
  rubber: ["rubber", "rezina", "резин"],
  ceramic: ["ceramic", "porcelain", "keramika", "farfor", "керамик", "фарфор"],
  clay: ["clay", "loy$", "глин"],
  wood: ["wood", "wooden", "yog'och", "yogoch", "дерев"],
  neon: ["neon", "glowing", "glow", "neon", "yonuvchi", "неон", "светящ"],
  lava: ["lava", "fire", "olov", "лава", "огн"],
  jade: ["jade", "nefrit", "нефрит"],
  pearl: ["pearl", "marvarid", "жемчуг"],
  carbon: ["carbon", "karbon", "карбон"],
  ice: ["ice", "frozen", "muz$", "лёд", "лед", "ледян"],
  velvet: ["velvet", "baxmal", "бархат"],
  hologram: ["hologram", "holographic", "gologramma", "голограм"],
  wireframe: ["wireframe", "sim karkas", "каркас"],
  toon: ["low-poly", "low poly", "flat shaded", "низкополиг"],
};

/** Named colors → hex. */
export const COLORS: Array<[string, string[]]> = [
  ["#e5484d", ["red", "crimson", "qizil", "красн", "алый"]],
  ["#0090ff", ["blue", "ko'k", "kok$", "moviy", "син", "голуб"]],
  ["#30a46c", ["green", "yashil", "зелен", "зелён"]],
  ["#ffc53d", ["yellow", "sariq", "жёлт", "желт"]],
  ["#f76b15", ["orange", "to'q sariq", "apelsin", "оранж"]],
  ["#8e4ec6", ["purple", "violet", "binafsha", "siyohrang", "фиолет", "пурпур"]],
  ["#e93d82", ["pink", "magenta", "pushti", "розов"]],
  ["#f5f5f7", ["white", "oq$", "бел"]],
  ["#16171b", ["black", "qora", "черн", "чёрн"]],
  ["#8b8d98", ["gray", "grey", "kulrang", "сер$", "серый", "серая", "серое", "серые"]],
  ["#a1734e", ["brown", "jigarrang", "qo'ng'ir", "корич"]],
  ["#12a594", ["teal", "turquoise", "firuza", "бирюз"]],
  ["#1e2a5a", ["navy", "dark blue", "to'q ko'k", "тёмно-син", "темно-син"]],
  ["#00c2e0", ["cyan", "aqua", "havorang", "циан"]],
  ["#bdee63", ["lime", "laym", "лайм"]],
  ["#5b4cf0", ["indigo", "индиго"]],
  ["#c9a227", ["golden color", "oltinrang"]],
];

export const MODULE_WORDS: Lex = {
  home: ["dashboard", "home", "bosh sahifa", "главн", "дашборд"],
  builder: ["builder", "editor", "konstruktor", "конструктор", "редактор"],
  studio: ["3d studio", "studio", "3d", "studiya", "студи"],
  vault: ["vault", "secrets", "keys", "ombor", "maxfiy", "kalit", "хранилищ", "секрет", "ключ"],
  data: ["data", "database", "sql", "ma'lumot", "данн", "баз"],
  deploy: ["deploy", "publish", "joylash", "chiqar", "деплой", "публика"],
  monitoring: ["monitor", "uptime", "analytics", "monitoring", "мониторинг", "аналитик"],
  motion: ["motion", "animation studio", "harakat", "анимац"],
  media: ["media", "brand", "images", "media", "медиа", "бренд"],
  collab: ["collaboration", "hamkorlik", "совместн"],
  marketplace: ["marketplace", "market", "do'kon", "маркет"],
  plugins: ["plugin", "plagin", "плагин"],
  audit: ["audit", "log", "jurnal", "журнал", "аудит"],
  settings: ["settings", "preferences", "sozlama", "настройк"],
  academy: ["academy", "course", "tutorials", "lessons", "akademiya", "kurs", "darslar", "академи", "курс", "уроки"],
  lab: ["forge lab", "lab", "laboratoriya", "лаборатор"],
};

export const LANG_NAMES: Lex = {
  en: ["english", "ingliz", "англ"],
  uz: ["uzbek", "o'zbek", "ozbek", "узбек"],
  ru: ["russian", "rus$", "rus tili", "русск"],
};

export const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, single: 1, two: 2, pair: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, dozen: 12,
  bir: 1, bitta: 1, ikki: 2, ikkita: 2, uch: 3, uchta: 3, "to'rt": 4, "to'rtta": 4, tort: 4, besh: 5, beshta: 5, olti: 6, oltita: 6, yetti: 7, sakkiz: 8, "to'qqiz": 9, "o'n": 10, "o'nta": 10,
  один: 1, одна: 1, одно: 1, одну: 1, одним: 1, одной: 1, два: 2, две: 2, двумя: 2, двух: 2, три: 3, тремя: 3, трёх: 3, трех: 3, четырьмя: 4, четырёх: 4, пятью: 5, пяти: 5,
  ikkala: 2, uchala: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10,
};

/** Industry/domain detection for generated copy. */
export const DOMAINS: Lex = {
  restaurant: ["restaurant", "cafe", "coffee", "food", "bakery", "pizza", "kitchen", "menu", "restoran", "kafe", "oshxona", "taom", "qahva", "ресторан", "кафе", "кофе", "еда", "пиццер", "пекарн"],
  fitness: ["gym", "fitness", "yoga", "sport", "workout", "trainer", "sport zal", "fitnes", "trener", "фитнес", "спортзал", "йога", "тренер"],
  clinic: ["clinic", "doctor", "health", "medical", "dental", "hospital", "klinika", "shifokor", "tibbiy", "stomatolog", "клиник", "врач", "медицин", "стоматолог", "здоров"],
  education: ["school", "course", "academy", "education", "learning", "university", "tutor", "maktab", "kurs", "akademiya", "ta'lim", "o'quv", "школ", "курс", "академ", "обучен", "образован"],
  realestate: ["real estate", "property", "apartment", "realty", "house", "ko'chmas mulk", "kvartira", "uy-joy", "недвижим", "квартир", "жиль"],
  travel: ["travel", "tour", "hotel", "trip", "tourism", "sayohat", "mehmonxona", "turizm", "путешеств", "тур", "отел", "туризм"],
  finance: ["finance", "bank", "fintech", "payments", "invest", "accounting", "moliya", "bank", "to'lov", "investitsiya", "финанс", "банк", "платеж", "инвест", "бухгалтер"],
  agency: ["agency", "studio", "marketing", "design studio", "creative", "agentlik", "marketing", "агентств", "маркетинг", "дизайн-студ", "креатив"],
  fashion: ["fashion", "clothing", "apparel", "boutique", "kiyim", "moda", "butik", "одежд", "мода", "бутик"],
  saas: ["saas", "software", "app", "platform", "startup", "tool", "dastur", "platforma", "startap", "программ", "платформ", "стартап", "сервис"],
  photography: ["photography", "photographer", "wedding", "fotograf", "to'y", "фотограф", "свадеб"],
  law: ["law", "lawyer", "legal", "attorney", "yurist", "advokat", "huquq", "юрист", "адвокат", "юридическ"],
};

// ----------------------------------------------------------------------------------------------

export function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[‘’ʻʼ`´]/g, "'")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(text: string): string[] {
  return normalize(text)
    .replace(/#[0-9a-f]{3,8}\b/g, " ")
    .split(/[^\p{L}\p{N}'-]+/u)
    .filter(Boolean);
}

function stemMatches(token: string, stem: string): boolean {
  if (stem.endsWith("$")) return token === stem.slice(0, -1);
  return token.startsWith(stem);
}

/** True when the text (normalized) contains any of the stems; multi-word stems match as phrases. */
export function hasAny(text: string, tokens: string[], stems: string[]): boolean {
  return stems.some((s) => (s.includes(" ") ? text.includes(s.replace(/\$$/, "")) : tokens.some((t) => stemMatches(t, s))));
}

/** Find the first matching key of a lexicon, with the token index where it matched (phrases → -1). */
export function findAll(text: string, tokens: string[], lex: Lex): Array<{ key: string; index: number }> {
  const hits: Array<{ key: string; index: number }> = [];
  for (const [key, stems] of Object.entries(lex)) {
    for (const s of stems) {
      if (s.includes(" ")) {
        const pos = text.indexOf(s);
        if (pos >= 0) {
          hits.push({ key, index: text.slice(0, pos).split(" ").filter(Boolean).length });
          break;
        }
      } else {
        const i = tokens.findIndex((t) => stemMatches(t, s));
        if (i >= 0) {
          hits.push({ key, index: i });
          break;
        }
      }
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

export function firstKey(text: string, tokens: string[], lex: Lex): string | null {
  return findAll(text, tokens, lex)[0]?.key ?? null;
}

export function detectLang(input: string): Lang {
  if (/[а-яё]/i.test(input)) return "ru";
  const t = normalize(input);
  if (/[oʻg]['‘’ʻ]/.test(input) || /\b(va|uchun|qil|yarat|qo'sh|sahifa|sayt|bilan|menga|qiling|kerak|qanday|nima|ham)\b/.test(t)) return "uz";
  return "en";
}

export function colorFrom(text: string, tokens: string[]): string | null {
  const hex = /#([0-9a-f]{6}|[0-9a-f]{3})\b/i.exec(text);
  if (hex) return hex[0].length === 4 ? `#${hex[1].split("").map((c) => c + c).join("")}` : hex[0];
  for (const [value, stems] of COLORS) if (hasAny(text, tokens, stems)) return value;
  return null;
}

/** All colors mentioned, in order of appearance (by token index). */
export function colorsAt(text: string, tokens: string[]): Array<{ hex: string; index: number }> {
  const out: Array<{ hex: string; index: number }> = [];
  const hex = /#([0-9a-f]{6}|[0-9a-f]{3})\b/i.exec(text);
  if (hex) out.push({ hex: colorFrom(hex[0], [])!, index: -1 });
  tokens.forEach((tok, i) => {
    for (const [value, stems] of COLORS) if (stems.some((s) => !s.includes(" ") && stemMatches(tok, s))) out.push({ hex: value, index: i });
  });
  return out;
}

export function quoted(input: string): string | null {
  const m = /["“«]([^"”»]{1,80})["”»]/.exec(input) ?? /'([^']{2,80})'/.exec(input);
  return m ? m[1].trim() : null;
}

export function numberBefore(tokens: string[], index: number): number {
  for (let i = index - 1; i >= Math.max(0, index - 4); i--) {
    const t = tokens[i];
    if (/^\d+$/.test(t)) return Math.min(50, Number(t));
    if (NUMBER_WORDS[t] !== undefined) return NUMBER_WORDS[t];
    const stripped = t.replace(/(ta|та)$/, "");
    if (NUMBER_WORDS[stripped] !== undefined) return NUMBER_WORDS[stripped];
  }
  return 1;
}
