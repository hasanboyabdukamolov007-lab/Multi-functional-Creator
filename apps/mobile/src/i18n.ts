const DICT = {
  en: {
    title: "Connect to your panel",
    subtitle: "Enter the address of your panel server — the same one you open in the browser.",
    label: "Server address",
    connect: "Connect",
    anyway: "Connect anyway",
    checking: "Checking…",
    notPanel: "This address answered, but it isn't a Multi-functional Creator server.",
    unreachable: "Couldn't reach this address. Check it and your connection.",
    insecure: "Use https:// — plain http only works for localhost and your local network.",
    hint: "Sign in with the 6-digit code from the sign-in email.",
    locked: "Locked",
    unlock: "Unlock",
    unlockReason: "Unlock Multi-functional Creator",
    offline: "Can't load the panel",
    offlineBody: "Check your connection, or change the server.",
    retry: "Try again",
    changeServer: "Change server",
    saved: "Saved {name}",
    saveFailed: "Couldn't save the file",
  },
  uz: {
    title: "Panelingizga ulaning",
    subtitle: "Panel serveringiz manzilini kiriting — brauzerda ochadiganingiz.",
    label: "Server manzili",
    connect: "Ulanish",
    anyway: "Baribir ulanish",
    checking: "Tekshirilmoqda…",
    notPanel: "Bu manzil javob berdi, lekin bu Multi-functional Creator serveri emas.",
    unreachable: "Bu manzilga ulanib bo‘lmadi. Manzil va internetni tekshiring.",
    insecure: "https:// dan foydalaning — oddiy http faqat localhost va mahalliy tarmoqda ishlaydi.",
    hint: "Kirish emailidagi 6 xonali kod bilan kiring.",
    locked: "Qulflangan",
    unlock: "Ochish",
    unlockReason: "Multi-functional Creator’ni ochish",
    offline: "Panelni yuklab bo‘lmadi",
    offlineBody: "Internetni tekshiring yoki serverni almashtiring.",
    retry: "Qayta urinish",
    changeServer: "Serverni almashtirish",
    saved: "{name} saqlandi",
    saveFailed: "Faylni saqlab bo‘lmadi",
  },
  ru: {
    title: "Подключитесь к панели",
    subtitle: "Введите адрес сервера панели — тот же, что открываете в браузере.",
    label: "Адрес сервера",
    connect: "Подключиться",
    anyway: "Всё равно подключиться",
    checking: "Проверяем…",
    notPanel: "Адрес отвечает, но это не сервер Multi-functional Creator.",
    unreachable: "Не удалось подключиться. Проверьте адрес и сеть.",
    insecure: "Используйте https:// — http работает только для localhost и локальной сети.",
    hint: "Входите по 6-значному коду из письма.",
    locked: "Заблокировано",
    unlock: "Разблокировать",
    unlockReason: "Разблокировать Multi-functional Creator",
    offline: "Не удалось загрузить панель",
    offlineBody: "Проверьте подключение или смените сервер.",
    retry: "Повторить",
    changeServer: "Сменить сервер",
    saved: "Сохранено: {name}",
    saveFailed: "Не удалось сохранить файл",
  },
} as const;

export type Key = keyof (typeof DICT)["en"];
const detected = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale.slice(0, 2);
  } catch {
    return "en";
  }
})();
const lang: keyof typeof DICT = detected === "uz" || detected === "ru" ? detected : "en";

export function t(key: Key, vars: Record<string, string> = {}): string {
  return DICT[lang][key].replace(/\{(\w+)\}/g, (_, n: string) => vars[n] ?? "");
}
