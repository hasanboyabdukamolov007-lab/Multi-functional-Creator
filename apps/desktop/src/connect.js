// Connect screen: check the address answers like a Multi-functional Creator server, then hand it to Rust.
const T = {
  en: {
    title: "Connect to your panel",
    subtitle: "Enter the address of your panel server — the same one you open in the browser.",
    label: "Server address",
    connect: "Connect",
    anyway: "Connect anyway",
    hint: "Sign in with the 6-digit code from the sign-in email. Change the server later from the Server menu.",
    checking: "Checking {url}…",
    notPanel: "{url} answered, but it isn't a Multi-functional Creator server.",
    unreachable: "Couldn't reach {url}. Check the address and your connection.",
    ok: "Connected to {url} (version {v})",
  },
  uz: {
    title: "Panelingizga ulaning",
    subtitle: "Panel serveringiz manzilini kiriting — brauzerda ochadiganingiz.",
    label: "Server manzili",
    connect: "Ulanish",
    anyway: "Baribir ulanish",
    hint: "Kirish emailidagi 6 xonali kod bilan kiring. Serverni keyin Server menyusidan o‘zgartirasiz.",
    checking: "{url} tekshirilmoqda…",
    notPanel: "{url} javob berdi, lekin bu Multi-functional Creator serveri emas.",
    unreachable: "{url} ga ulanib bo‘lmadi. Manzil va internetni tekshiring.",
    ok: "{url} ga ulandi (versiya {v})",
  },
  ru: {
    title: "Подключитесь к панели",
    subtitle: "Введите адрес сервера панели — тот же, что открываете в браузере.",
    label: "Адрес сервера",
    connect: "Подключиться",
    anyway: "Всё равно подключиться",
    hint: "Входите по 6-значному коду из письма. Сменить сервер можно в меню «Server».",
    checking: "Проверяем {url}…",
    notPanel: "{url} отвечает, но это не сервер Multi-functional Creator.",
    unreachable: "Не удалось подключиться к {url}. Проверьте адрес и сеть.",
    ok: "Подключено к {url} (версия {v})",
  },
};

const $ = (id) => document.getElementById(id);
const store = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();
let lang = store?.getItem("mfc.desktop.lang") || (navigator.language || "en").slice(0, 2);
if (!T[lang]) lang = "en";
const tr = (k, vars = {}) => (T[lang][k] || T.en[k]).replace(/\{(\w+)\}/g, (_, n) => vars[n] ?? "");

function applyLang() {
  document.documentElement.lang = lang;
  $("lang").value = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = tr(el.dataset.i18n)));
}

const invoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);

function normalise(raw) {
  let s = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(s)) s = (/^(localhost|127\.|10\.|192\.168\.)/.test(s) ? "http://" : "https://") + s;
  return new URL(s).origin;
}

function status(text, kind = "") {
  $("status").textContent = text;
  $("status").className = `status ${kind}`;
}

async function check(origin) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(`${origin}/api/app-info`, { signal: ctl.signal });
    const info = await res.json().catch(() => null);
    return info && info.name === "Multi-functional Creator" ? { ok: true, version: info.version } : { ok: false, reason: "notPanel" };
  } catch {
    return { ok: false, reason: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

async function connect(origin) {
  try {
    await invoke("connect", { url: origin });
  } catch (e) {
    status(String(e), "error");
    $("go").disabled = false;
  }
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("anyway").hidden = true;
  let origin;
  try {
    origin = normalise($("url").value);
  } catch {
    status(tr("unreachable", { url: $("url").value }), "error");
    return;
  }
  $("go").disabled = true;
  status(tr("checking", { url: origin }));
  const r = await check(origin);
  if (r.ok) {
    status(tr("ok", { url: origin, v: r.version }), "ok");
    await connect(origin);
  } else {
    status(tr(r.reason, { url: origin }), "error");
    $("anyway").hidden = false;
    $("anyway").onclick = () => connect(origin);
    $("go").disabled = false;
  }
});

document.querySelectorAll("[data-url]").forEach((b) => b.addEventListener("click", () => ($("url").value = b.dataset.url)));
$("lang").addEventListener("change", (e) => {
  lang = e.target.value;
  store?.setItem("mfc.desktop.lang", lang);
  applyLang();
});

applyLang();
if (window.__TAURI__) {
  invoke("get_server").then((url) => {
    if (url) $("url").value = url.replace(/\/$/, "");
  });
}
