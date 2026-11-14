/** One concept in Forge's knowledge base. Summaries are trilingual; details are concise expert notes. */
export interface L3 {
  en: string;
  uz: string;
  ru: string;
}
export interface QuizQ {
  q: string;
  options: string[];
  answer: number;
  why: string;
}
export interface KEntry {
  id: string;
  cat: KCat;
  title: L3;
  /** Search words and stems in all three languages (prefixes match: "flex" matches "flexbox"). */
  kw: string[];
  sum: L3;
  points: string[];
  example?: { lang: string; code: string };
  pitfalls?: string[];
  related?: string[];
  quiz?: QuizQ[];
  /** A panel function that lets the learner try this right away. */
  tryFn?: string;
}
export type KCat = "web" | "css" | "js" | "react" | "api" | "data" | "security" | "devops" | "design" | "3d" | "panel";
export const CAT_LABEL: Record<KCat, L3> = {
  web: { en: "Web fundamentals", uz: "Veb asoslari", ru: "Основы веба" },
  css: { en: "CSS & layout", uz: "CSS va maket", ru: "CSS и вёрстка" },
  js: { en: "JavaScript & TypeScript", uz: "JavaScript va TypeScript", ru: "JavaScript и TypeScript" },
  react: { en: "React & front-end apps", uz: "React va frontend ilovalar", ru: "React и фронтенд" },
  api: { en: "APIs & back-end", uz: "API va backend", ru: "API и бэкенд" },
  data: { en: "Databases & data", uz: "Ma’lumotlar bazalari", ru: "Базы данных" },
  security: { en: "Security", uz: "Xavfsizlik", ru: "Безопасность" },
  devops: { en: "Deploy & operations", uz: "Joylash va ekspluatatsiya", ru: "Деплой и эксплуатация" },
  design: { en: "Design & UX", uz: "Dizayn va UX", ru: "Дизайн и UX" },
  "3d": { en: "3D & motion", uz: "3D va animatsiya", ru: "3D и анимация" },
  panel: { en: "Using this panel", uz: "Paneldan foydalanish", ru: "Работа с панелью" },
};
