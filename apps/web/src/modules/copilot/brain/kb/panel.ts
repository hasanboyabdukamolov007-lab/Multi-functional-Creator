import type { KEntry } from "./types";

/** How to use this panel. The Academy and Forge also generate entries for every registered function at runtime. */
export const PANEL: KEntry[] = [
  {
    id: "panel-palette",
    cat: "panel",
    title: { en: "Command palette & shortcuts", uz: "Buyruqlar palitrasi va tezkor tugmalar", ru: "Палитра команд и горячие клавиши" },
    kw: ["palette", "command", "shortcut", "ctrl k", "search function", "hotkey", "buyruq", "tezkor", "команд", "горяч", "палитр"],
    sum: {
      en: "Everything in the panel is a function. Press Ctrl/⌘ K (or tap 🔍) to search all of them by name or keyword and run one; Shift+? lists the shortcuts.",
      uz: "Paneldagi hamma narsa — funksiya. Ctrl/⌘ K (yoki 🔍) ni bosib nomi yoki kalit so‘zi bo‘yicha qidiring va bajaring; Shift+? tezkor tugmalarni ko‘rsatadi.",
      ru: "Всё в панели — функции. Нажмите Ctrl/⌘ K (или 🔍), найдите по имени или слову и запустите; Shift+? покажет горячие клавиши.",
    },
    points: ["Recently used functions appear first.", "Ctrl/⌘ J opens Forge; Ctrl/⌘ S saves; Ctrl/⌘ Z / Shift+Z undo and redo.", "Functions that don't apply right now explain why (e.g. “Open a builder project first”)."],
    tryFn: "ui.palette",
  },
  {
    id: "panel-builder",
    cat: "panel",
    title: { en: "Building pages in the Builder", uz: "Builder’da sahifa yaratish", ru: "Создание страниц в конструкторе" },
    kw: ["builder", "page", "component", "drag", "drop", "inspector", "layers", "template", "konstruktor", "sahifa", "конструктор", "страниц", "шаблон"],
    sum: {
      en: "Start from a template or blank page, drag (or tap) components onto the canvas, edit text in place, style in the Inspector, preview on phone/tablet/desktop and export HTML, React, Next.js or Expo.",
      uz: "Shablon yoki bo‘sh sahifadan boshlang, komponentlarni kanvasga torting (yoki bosing), matnni joyida tahrirlang, Inspector’da bezang, telefon/planshet/kompyuterda ko‘ring va HTML, React, Next.js yoki Expo’ga eksport qiling.",
      ru: "Начните с шаблона или пустой страницы, перетащите (или коснитесь) компоненты на холст, редактируйте текст на месте, стилизуйте в инспекторе, проверьте на телефоне/планшете/ПК и экспортируйте в HTML, React, Next.js или Expo.",
    },
    points: ["Double-click text to edit it directly.", "Site tokens (colors, radius, fonts) restyle every page at once.", "The Check button audits accessibility; every export is scanned for leaked secrets.", "The Code panel edits the page JSON with two-way sync."],
    related: ["html-semantics", "responsive", "a11y"],
    tryFn: "nav.builder",
  },
  {
    id: "panel-studio",
    cat: "panel",
    title: { en: "Modelling in the 3D Studio", uz: "3D Studio’da modellash", ru: "Моделирование в 3D-студии" },
    kw: ["studio", "3d studio", "gizmo", "outliner", "timeline", "keyframe", "import model", "export glb", "studiya", "студи"],
    sum: {
      en: "Add primitives or extruded shapes, move/rotate/scale with the gizmo, pick PBR materials, light the scene, animate with keyframes on the timeline and export GLB, OBJ, STL or PNG.",
      uz: "Primitivlar yoki ekstruziya shakllarini qo‘shing, gizmo bilan siljiting/aylantiring/kattalashtiring, PBR material tanlang, sahnani yoriting, vaqt chizig‘ida kadrlar bilan animatsiya qiling va GLB, OBJ, STL yoki PNG’ga eksport qiling.",
      ru: "Добавляйте примитивы и выдавленные формы, двигайте/вращайте/масштабируйте гизмо, выбирайте PBR-материалы, ставьте свет, анимируйте ключевыми кадрами и экспортируйте в GLB, OBJ, STL или PNG.",
    },
    points: ["W / E / R switch move, rotate and scale.", "Auto-key records a keyframe whenever you change something.", "Import GLB/GLTF/OBJ/FBX/STL models."],
    related: ["3d-basics", "pbr-materials", "motion-principles"],
    tryFn: "nav.studio",
  },
  {
    id: "panel-vault",
    cat: "panel",
    title: { en: "Using the Secrets Vault", uz: "Seyfdan foydalanish", ru: "Работа с хранилищем секретов" },
    kw: ["vault", "seyf", "хранилищ", "reveal", "rotate", "env import", "leak scanner"],
    sum: {
      en: "Add API keys and passwords once; they're encrypted with AES-256-GCM, shown masked, revealed only with an audit entry, versioned, and injected into API calls, workflows and deploys as {{ secrets.NAME }}.",
      uz: "API kalit va parollarni bir marta qo‘shing; ular AES-256-GCM bilan shifrlanadi, yashirin ko‘rsatiladi, faqat audit yozuvi bilan ochiladi, versiyalanadi va API, workflow va joylashga {{ secrets.NAME }} sifatida qo‘yiladi.",
      ru: "Добавьте ключи и пароли один раз: они шифруются AES-256-GCM, показываются маской, раскрываются только с записью в аудит, версионируются и подставляются в API, автоматизации и деплой как {{ secrets.NAME }}.",
    },
    points: ["Import an existing .env file in one step.", "Set expiry or rotation reminders.", "The leak scanner checks any text for keys before you share it."],
    related: ["secrets"],
    tryFn: "vault.new",
  },
  {
    id: "panel-forge",
    cat: "panel",
    title: { en: "Working with Forge", uz: "Forge bilan ishlash", ru: "Работа с Forge" },
    kw: ["forge", "copilot", "assistant", "ai", "help", "yordamchi", "ассистент", "копилот"],
    sum: {
      en: "Forge runs inside the panel with no AI model: it understands English, Uzbek and Russian, builds pages, 3D scenes, APIs and databases, explains concepts, fixes code, quizzes you, and learns from your feedback and projects.",
      uz: "Forge panel ichida AI modelsiz ishlaydi: ingliz, o‘zbek va rus tillarini tushunadi, sahifa, 3D sahna, API va baza yaratadi, tushunchalarni tushuntiradi, kodni tuzatadi, test qiladi va fikringiz hamda loyihalaringizdan o‘rganadi.",
      ru: "Forge работает внутри панели без ИИ-модели: понимает английский, узбекский и русский, создаёт страницы, 3D-сцены, API и базы, объясняет понятия, исправляет код, проверяет знания и учится на ваших отзывах и проектах.",
    },
    points: ["“Explain flexbox”, “teach me SQL joins”, “quiz me on security”.", "“Fix this: <paste code>” returns corrected code with reasons.", "👍/👎 under answers teach it; the Lab shows what it has learned."],
    tryFn: "copilot.open",
  },
  {
    id: "panel-data",
    cat: "panel",
    title: { en: "Data & APIs tools", uz: "Ma’lumot va API vositalari", ru: "Инструменты данных и API" },
    kw: ["data", "api tester", "database browser", "schema designer", "api generator", "workflow", "ma’lumot", "данные"],
    sum: {
      en: "Test any HTTP API from the server, browse and query Postgres/MySQL/MongoDB, design schemas visually with migrations, generate a complete REST backend, and automate with webhook/cron workflows.",
      uz: "Har qanday HTTP API’ni serverdan sinang, Postgres/MySQL/MongoDB’ni ko‘ring va so‘rang, sxemani migratsiyalar bilan vizual loyihalang, to‘liq REST backend yarating va webhook/cron workflow’lar bilan avtomatlashtiring.",
      ru: "Тестируйте любые HTTP API с сервера, просматривайте Postgres/MySQL/MongoDB, проектируйте схемы с миграциями, генерируйте REST-бэкенд и автоматизируйте вебхуками и cron.",
    },
    points: ["Connection strings live in the vault, never in the browser.", "Queries are read-only unless you switch writes on.", "Import a live database into the schema designer."],
    related: ["rest-api", "sql-basics", "webhooks"],
    tryFn: "nav.data",
  },
];
