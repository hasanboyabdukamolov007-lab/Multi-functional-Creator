import { registerCoreFunctions, registerPanelTweaks } from "./lib/coreFunctions";
import { registerBuilderExtraFunctions, registerBuilderFunctions } from "./modules/builder/functions";
import { registerStudioExtraFunctions, registerStudioFunctions } from "./modules/studio/functions";
import { registerVaultFunctions } from "./modules/vault/functions";
import { registerCopilotFunctions } from "./modules/copilot/functions";
import { registerDataFunctions } from "./modules/data/functions";
import { registerDeployFunctions } from "./modules/deploy/functions";

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
  registerDataFunctions();
  registerDeployFunctions();
  registerPanelTweaks();
  registerBuilderExtraFunctions();
  registerStudioExtraFunctions();
}
