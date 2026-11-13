import { registerCoreFunctions } from "./lib/coreFunctions";
import { registerBuilderFunctions } from "./modules/builder/functions";

let done = false;
/** Register every panel function. Runs once at startup so the palette and copilot see them all. */
export function registerAllFunctions() {
  if (done) return;
  done = true;
  registerCoreFunctions();
  registerBuilderFunctions();
}
