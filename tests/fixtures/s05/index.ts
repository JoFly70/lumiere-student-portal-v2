import { scenarioA } from "./scenario-a";
import { scenarioE } from "./scenario-e";
import { scenarioM } from "./scenario-m";
import { scenarioN } from "./scenario-n";
import { scenarioR } from "./scenario-r";
import { scenarioRc } from "./scenario-rc";
import { scenarioS } from "./scenario-s";
import type { ScenarioFixture } from "./builders";

export { aiPackageScenarioS, aiPackageScenarioSExpectations } from "./ai-package-s";
export * from "./builders";
export { scenarioA, scenarioE, scenarioM, scenarioN, scenarioR, scenarioRc, scenarioS };

export const s05Scenarios: readonly ScenarioFixture[] = [
  scenarioR, scenarioN, scenarioM, scenarioA, scenarioRc, scenarioE, scenarioS,
];

export const s05ScenariosById = Object.fromEntries(s05Scenarios.map((s) => [s.id, s])) as Record<ScenarioFixture["id"], ScenarioFixture>;
