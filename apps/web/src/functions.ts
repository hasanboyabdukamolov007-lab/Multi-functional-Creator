import { registerCoreFunctions } from "./lib/coreFunctions";
import { registerBuilderFunctions } from "./modules/builder/functions";
import { registerStudioFunctions } from "./modules/studio/functions";
import { registerVaultFunctions } from "./modules/vault/functions";
import { registerCopilotFunctions } from "./modules/copilot/functions";

let done = false;
/** Register every panel function. Runs once at startup so the palette and copilot see them all. */
export function registerAllFunctions() {
  if (done) return;
  done = true;
  registerCoreFunctions();
  registerBuilderFunctions();
  registerStudioFunctions();
  registerVaultFunctions();
  registerCopilotFunctions();
}
