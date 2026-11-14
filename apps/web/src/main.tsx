import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/app.css";
import { applyTheme, useTheme } from "./lib/theme";
import { useI18n } from "./lib/i18n";
import { registerAllFunctions } from "./functions";
import { initPwa } from "./lib/pwa";

applyTheme(useTheme.getState().active().tokens);
document.documentElement.lang = useI18n.getState().locale;
registerAllFunctions();
initPwa();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
