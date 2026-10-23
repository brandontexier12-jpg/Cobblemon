import { cricket } from "./modes/cricket.js";
import { countUp, highScore, warmup } from "./modes/scoring-games.js";
import { aroundTheClock, aroundTheWorld, bobs27, killer, shanghai } from "./modes/target-games.js";
import { bullTraining, checkoutTraining, customTraining, doublesTraining, triplesTraining } from "./modes/training.js";
import { x01 } from "./modes/x01.js";
import type { GameModeId, ModeRules } from "./types.js";

const RULES: Record<GameModeId, ModeRules<any, any>> = {
  x01,
  cricket,
  count_up: countUp,
  high_score: highScore,
  warmup,
  around_the_clock: aroundTheClock,
  around_the_world: aroundTheWorld,
  bobs_27: bobs27,
  killer,
  shanghai,
  doubles_training: doublesTraining,
  triples_training: triplesTraining,
  bull_training: bullTraining,
  checkout_training: checkoutTraining,
  custom_training: customTraining,
};

export function getRules(mode: GameModeId): ModeRules<unknown, unknown> {
  const rules = RULES[mode];
  if (!rules) throw new Error(`Mode inconnu : ${mode}`);
  return rules;
}
