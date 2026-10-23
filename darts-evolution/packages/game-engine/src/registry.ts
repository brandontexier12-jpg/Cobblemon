import { BULL, createRng, shuffle } from "@darts-evolution/shared";
import { z } from "zod";
import { canCheckout } from "./checkout.js";
import type { TargetSpec } from "./modes/helpers.js";
import type { GameCategory, GameModeId, PlayerRef } from "./types.js";

const inOut = z.enum(["single", "double", "master"]);
const segment = z.number().int().refine((v) => (v >= 1 && v <= 20) || v === BULL, "Secteur invalide (1 à 20 ou 25)");
const ring = z.enum(["any", "single", "double", "triple", "outer_bull", "inner_bull"]);
const order = z.enum(["sequential", "random"]).default("sequential");
const progression = z.enum(["fixed", "until_hit"]).default("fixed");
const goalPercent = z.number().int().min(1).max(100).optional();

export const OPTION_SCHEMAS = {
  x01: z.object({
    startScore: z.number().int().refine((v) => [101, 301, 501, 701, 901, 1001].includes(v), "Score de départ non pris en charge").default(501),
    inRule: inOut.default("single"),
    outRule: inOut.default("double"),
    legs: z.number().int().min(1).max(21).default(1),
    sets: z.number().int().min(1).max(13).default(1),
    checkoutStrategy: z.enum(["classique", "bull", "double_favori"]).default("classique"),
    favoriteDouble: segment.optional(),
  }),
  cricket: z.object({
    variant: z.enum(["standard", "cut_throat"]).default("standard"),
    maxRounds: z.number().int().min(0).max(99).default(20),
  }),
  count_up: z.object({ target: z.number().int().min(50).max(5000).default(300) }),
  high_score: z.object({ rounds: z.number().int().min(1).max(50).default(10) }),
  warmup: z.object({ darts: z.number().int().min(30).max(999).default(100) }),
  around_the_clock: z.object({
    ring: z.enum(["any", "single", "double", "triple"]).default("any"),
    includeBull: z.boolean().default(true),
    skipOnMultiplier: z.boolean().default(false),
  }),
  around_the_world: z.object({ includeBull: z.boolean().default(true) }),
  bobs_27: z.object({ includeBull: z.boolean().default(false) }),
  killer: z.object({
    variant: z.enum(["remplissage", "classique"]).default("remplissage"),
    lives: z.number().int().min(1).max(9).default(3),
    zone: z.enum(["double", "any"]).optional(),
    selfPenalty: z.boolean().optional(),
    firstRoundProtection: z.boolean().default(true),
    numbers: z.array(z.number().int().min(1).max(20)).optional(),
  }),
  shanghai: z.object({
    rounds: z.number().int().min(1).max(20).default(7),
    instantWin: z.boolean().default(true),
  }),
  doubles_training: z.object({
    segments: z.array(segment).min(1).max(21).default(Array.from({ length: 20 }, (_, i) => i + 1)),
    order,
    progression,
    dartsPerTarget: z.number().int().min(1).max(30).default(3),
    maxDartsPerTarget: z.number().int().min(0).max(99).default(0),
    goalPercent,
  }),
  triples_training: z.object({
    segments: z.array(z.number().int().min(1).max(20)).min(1).max(20).default([20, 19, 18, 17, 16, 15]),
    order,
    progression,
    dartsPerTarget: z.number().int().min(1).max(30).default(3),
    maxDartsPerTarget: z.number().int().min(0).max(99).default(0),
    goalPercent,
  }),
  bull_training: z.object({
    rounds: z.number().int().min(1).max(50).default(10),
    ring: z.enum(["any", "inner_bull"]).default("any"),
    goalPercent,
  }),
  checkout_training: z.object({
    selection: z.enum(["random", "list"]).default("random"),
    count: z.number().int().min(1).max(60).default(10),
    min: z.number().int().min(2).max(170).default(40),
    max: z.number().int().min(2).max(170).default(100),
    values: z.array(z.number().int().min(2).max(170)).max(60).optional(),
    visitsPerTarget: z.number().int().min(1).max(5).default(1),
    outRule: inOut.default("double"),
  }),
  custom_training: z.object({
    name: z.string().trim().min(1).max(60).default("Exercice personnalisé"),
    targets: z.array(z.object({ segment, ring })).min(1).max(60),
    order,
    progression,
    dartsPerTarget: z.number().int().min(1).max(30).default(3),
    maxDartsPerTarget: z.number().int().min(0).max(99).default(0),
    rounds: z.number().int().min(1).max(10).default(1),
    goalPercent,
  }),
} satisfies Record<GameModeId, z.ZodTypeAny>;

export type ModeOptions<K extends GameModeId> = z.infer<(typeof OPTION_SCHEMAS)[K]>;

export interface ModeDefinition {
  id: GameModeId;
  name: string;
  category: GameCategory;
  summary: string;
  /** Règles documentées, affichées dans l'application. */
  rules: string[];
  minPlayers: number;
  maxPlayers: number;
}

export const MODES: ModeDefinition[] = [
  {
    id: "x01",
    name: "X01",
    category: "game",
    summary: "301, 501, 701, 901 ou 1001 : descendre exactement à zéro.",
    minPlayers: 1,
    maxPlayers: 8,
    rules: [
      "Chaque joueur part du score choisi (301, 501, 701, 901 ou 1001) et retire les points de chaque fléchette.",
      "Départ simple : toutes les fléchettes comptent. Départ double : rien ne compte avant un double (ou le bull 50). Départ master : avant un double ou un triple.",
      "Sortie simple : on termine exactement à 0 avec n'importe quelle fléchette. Sortie double : la dernière fléchette doit être un double (ou le bull 50). Sortie master : un double ou un triple.",
      "Bust : si le score passe sous 0, s'il reste 1 en sortie double/master, ou si 0 est atteint sans la fléchette requise, la visite ne compte pas et le joueur revient au score du début de la visite.",
      "Le premier à terminer gagne le leg. Le match se joue au premier à N legs (et premier à N sets si les sets sont activés). Le joueur qui commence alterne à chaque leg et à chaque set.",
    ],
  },
  {
    id: "cricket",
    name: "Cricket",
    category: "game",
    summary: "Fermer les numéros 15 à 20 et le bull, marquer des points.",
    minPlayers: 1,
    maxPlayers: 8,
    rules: [
      "Numéros en jeu : 15, 16, 17, 18, 19, 20 et le bull. Simple = 1 marque, double = 2, triple = 3 ; bull extérieur = 1 marque, bull intérieur = 2.",
      "Trois marques ferment un numéro. Les marques supplémentaires rapportent la valeur du numéro (25 pour le bull) tant qu'au moins un adversaire ne l'a pas fermé.",
      "Classique : les points sont pour le lanceur ; on gagne en ayant tout fermé avec au moins autant de points que chaque adversaire.",
      "Cut-throat : les points sont infligés aux adversaires qui n'ont pas fermé le numéro ; on gagne en ayant tout fermé avec au plus autant de points que chaque adversaire.",
      "Limite de manches (optionnelle) : à la fin de la dernière manche, le meilleur total gagne (départage au nombre de marques).",
    ],
  },
  {
    id: "count_up",
    name: "Count-up",
    category: "game",
    summary: "Premier à atteindre le total visé.",
    minPlayers: 1,
    maxPlayers: 8,
    rules: [
      "Chaque fléchette ajoute ses points au total du joueur.",
      "Le premier joueur qui atteint ou dépasse le total visé gagne immédiatement. Il n'y a pas de bust.",
    ],
  },
  {
    id: "high_score",
    name: "High Score",
    category: "game",
    summary: "Le meilleur total après un nombre de manches fixé.",
    minPlayers: 1,
    maxPlayers: 8,
    rules: [
      "Chaque joueur joue le même nombre de manches de 3 fléchettes.",
      "Toutes les fléchettes comptent ; le meilleur total à la fin de la dernière manche gagne (égalité possible).",
    ],
  },
  {
    id: "around_the_clock",
    name: "Around the Clock",
    category: "game",
    summary: "Toucher les numéros 1 à 20 (puis le bull) dans l'ordre.",
    minPlayers: 1,
    maxPlayers: 8,
    rules: [
      "Il faut toucher 1, puis 2, puis 3… jusqu'à 20, puis le bull si l'option est activée.",
      "Variante de zone : n'importe quelle partie du numéro, simple uniquement, double uniquement ou triple uniquement (au bull, le bull intérieur compte pour double et triple).",
      "Option « saut » (zone libre) : un double fait avancer de 2 numéros, un triple de 3, sans jamais sauter la dernière cible.",
      "Le premier à toucher la dernière cible gagne.",
    ],
  },
  {
    id: "around_the_world",
    name: "Around the World",
    category: "game",
    summary: "Une manche par numéro, de 1 à 20 puis le bull.",
    minPlayers: 1,
    maxPlayers: 8,
    rules: [
      "La manche 1 se joue sur le 1, la manche 2 sur le 2… jusqu'au 20, puis une manche sur le bull si l'option est activée.",
      "Chaque touche du numéro de la manche rapporte son multiplicateur : simple 1, double 2, triple 3 (bull extérieur 1, bull intérieur 2).",
      "Le meilleur total à la fin gagne.",
    ],
  },
  {
    id: "warmup",
    name: "Échauffement",
    category: "training",
    summary: "Lancer librement 100, 200 ou 300 fléchettes : compteur et score.",
    minPlayers: 1,
    maxPlayers: 4,
    rules: [
      "Lancez où vous voulez : chaque fléchette est comptée et ses points s'ajoutent au score.",
      "La séance se termine automatiquement quand le nombre de fléchettes choisi est atteint (la dernière volée peut compter moins de 3 fléchettes).",
      "Affichage : fléchettes lancées, score total, moyenne sur 3 fléchettes, meilleure visite, visites à 100+, 140+ et 180.",
      "À plusieurs, chacun lance le même nombre de fléchettes ; le meilleur score l'emporte.",
    ],
  },
  {
    id: "bobs_27",
    name: "Bob's 27",
    category: "training",
    summary: "Entraînement aux doubles de Bob Anderson : départ à 27 points.",
    minPlayers: 1,
    maxPlayers: 8,
    rules: [
      "On part avec 27 points et on joue une visite sur chaque double, de D1 à D20 (puis le bull si l'option est activée).",
      "Chaque double touché ajoute sa valeur (D1 = 2, D20 = 40, bull = 50).",
      "Si aucune des trois fléchettes ne touche le double, on retire sa valeur.",
      "Si le score devient négatif, le joueur est éliminé. Le meilleur score final gagne.",
    ],
  },
  {
    id: "killer",
    name: "Killer",
    category: "game",
    summary: "Remplir son numéro pour devenir Killer, puis éliminer les adversaires.",
    minPlayers: 2,
    maxPlayers: 8,
    rules: [
      "Chaque joueur reçoit un numéro différent, tiré au sort au début de la partie (roue).",
      "On remplit son numéro pour gagner des vies : simple +1, double +2, triple +3 (zone « doubles » : +1 par double), jusqu'à 3 vies (réglable).",
      "Avec toutes ses vies, on devient KILLER.",
      "Un Killer retire des vies en touchant le numéro d'un adversaire : simple 1, double 2, triple 3 (zone « doubles » : 1 par double).",
      "Un Killer qui repasse sous le maximum de vies perd son statut et doit remplir à nouveau son numéro.",
      "Un joueur touché alors qu'il n'a plus assez de vies est éliminé (pas d'élimination au premier tour, réglable). Le dernier joueur en jeu gagne.",
      "Option pénalité : un Killer qui touche son propre numéro perd des vies.",
      "Variante « classique » : on part avec toutes ses vies et un seul double de son numéro fait Killer.",
    ],
  },
  {
    id: "shanghai",
    name: "Shanghai",
    category: "game",
    summary: "Manche N sur le numéro N ; le Shanghai gagne immédiatement.",
    minPlayers: 1,
    maxPlayers: 8,
    rules: [
      "La manche 1 se joue sur le 1, la manche 2 sur le 2, etc. (7 manches par défaut, jusqu'à 20).",
      "Seules les touches du numéro de la manche comptent : numéro × multiplicateur.",
      "Shanghai : simple, double et triple du numéro dans la même visite = victoire immédiate (si l'option est active).",
      "Sinon, le meilleur total après la dernière manche gagne.",
    ],
  },
  {
    id: "doubles_training",
    name: "Entraînement doubles",
    category: "training",
    summary: "Série de doubles avec taux de réussite.",
    minPlayers: 1,
    maxPlayers: 4,
    rules: [
      "Choisissez les doubles (D1 à D20, bull), l'ordre (fixe ou aléatoire) et la progression.",
      "Progression fixe : N fléchettes par double, on compte les touches. Progression « jusqu'à la touche » : on reste sur le double jusqu'à le toucher (plafond optionnel) et on compte les fléchettes nécessaires.",
      "Réussite = touches / fléchettes lancées.",
    ],
  },
  {
    id: "triples_training",
    name: "Entraînement triples",
    category: "training",
    summary: "Série de triples (T20, T19…) avec taux de réussite.",
    minPlayers: 1,
    maxPlayers: 4,
    rules: [
      "Choisissez les triples visés, l'ordre et la progression (comme l'entraînement doubles).",
      "Seul le triple du numéro compte comme touche. Réussite = touches / fléchettes lancées.",
    ],
  },
  {
    id: "bull_training",
    name: "Entraînement bull",
    category: "training",
    summary: "Manches de 3 fléchettes au bull.",
    minPlayers: 1,
    maxPlayers: 4,
    rules: [
      "Chaque manche se compose de 3 fléchettes au bull.",
      "Cible « bull complet » : bull extérieur (25) et intérieur (50) comptent comme touches. Cible « bull intérieur » : seul le 50 compte.",
      "Les points (25 ou 50) sont additionnés ; réussite = touches / fléchettes.",
    ],
  },
  {
    id: "checkout_training",
    name: "Entraînement checkout",
    category: "training",
    summary: "Terminer des scores donnés, avec suivi du taux de réussite.",
    minPlayers: 1,
    maxPlayers: 4,
    rules: [
      "Une liste de scores à terminer est tirée au sort (scores réellement terminables) ou saisie.",
      "Pour chaque score, vous disposez d'un nombre de visites de 3 fléchettes ; les règles de sortie et de bust sont celles du X01.",
      "Un score est réussi s'il est terminé dans les visites autorisées. Taux de réussite = scores réussis / scores tentés.",
    ],
  },
  {
    id: "custom_training",
    name: "Exercice personnalisé",
    category: "training",
    summary: "Votre propre liste de cibles et d'objectifs.",
    minPlayers: 1,
    maxPlayers: 4,
    rules: [
      "Définissez une liste de cibles (secteur et zone : simple, double, triple, n'importe quelle zone, bull extérieur ou intérieur).",
      "Choisissez le nombre de fléchettes par cible, la progression, l'ordre et le nombre de répétitions de la liste.",
      "Réussite = touches / fléchettes lancées ; un objectif chiffré peut être fixé.",
    ],
  },
];

export function getModeDefinition(id: GameModeId): ModeDefinition {
  const def = MODES.find((m) => m.id === id);
  if (!def) throw new Error(`Mode inconnu : ${id}`);
  return def;
}

export function isGameModeId(value: unknown): value is GameModeId {
  return typeof value === "string" && MODES.some((m) => m.id === value);
}

export class ModeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModeConfigError";
  }
}

function orderTargets<T>(items: T[], how: "sequential" | "random", rng: () => number): T[] {
  return how === "random" ? shuffle(items, rng) : items;
}

/**
 * Valide les options saisies et produit la configuration définitive de la partie.
 * Les tirages au sort (numéros du Killer, ordre aléatoire, scores de checkout) sont faits ici,
 * une seule fois : la configuration enregistrée permet ensuite de rejouer la partie à l'identique.
 */
export function prepareConfig(mode: GameModeId, rawOptions: unknown, players: PlayerRef[], seed: number): unknown {
  const def = getModeDefinition(mode);
  if (players.length < def.minPlayers) {
    throw new ModeConfigError(`${def.name} nécessite au moins ${def.minPlayers} joueur(s).`);
  }
  if (players.length > def.maxPlayers) {
    throw new ModeConfigError(`${def.name} accepte au plus ${def.maxPlayers} joueurs.`);
  }
  const parsed = OPTION_SCHEMAS[mode].safeParse(rawOptions ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ModeConfigError(`Option invalide${issue?.path.length ? ` (${issue.path.join(".")})` : ""} : ${issue?.message ?? "valeur incorrecte"}`);
  }
  const rng = createRng(seed);
  switch (mode) {
    case "killer": {
      const o = parsed.data as ModeOptions<"killer">;
      let numbers = o.numbers;
      if (numbers) {
        if (numbers.length !== players.length || new Set(numbers).size !== numbers.length) {
          throw new ModeConfigError("Chaque joueur doit avoir un numéro différent.");
        }
      } else {
        numbers = shuffle(Array.from({ length: 20 }, (_, i) => i + 1), rng).slice(0, players.length);
      }
      const classic = o.variant === "classique";
      return {
        variant: o.variant,
        lives: o.lives,
        zone: o.zone ?? (classic ? "double" : "any"),
        selfPenalty: o.selfPenalty ?? classic,
        firstRoundProtection: o.firstRoundProtection,
        numbers,
      };
    }
    case "doubles_training":
    case "triples_training": {
      const o = parsed.data as ModeOptions<"doubles_training">;
      const ringName = mode === "doubles_training" ? "double" : "triple";
      const targets: TargetSpec[] = orderTargets(
        o.segments.map((s) => ({ segment: s, ring: ringName as TargetSpec["ring"] })),
        o.order,
        rng,
      );
      return {
        targets,
        progression: o.progression,
        dartsPerTarget: o.dartsPerTarget,
        maxDartsPerTarget: o.maxDartsPerTarget,
        goalPercent: o.goalPercent,
      };
    }
    case "bull_training": {
      const o = parsed.data as ModeOptions<"bull_training">;
      return {
        targets: [{ segment: BULL, ring: o.ring }],
        progression: "fixed",
        dartsPerTarget: o.rounds * 3,
        maxDartsPerTarget: 0,
        goalPercent: o.goalPercent,
      };
    }
    case "custom_training": {
      const o = parsed.data as ModeOptions<"custom_training">;
      const repeated: TargetSpec[] = [];
      for (let r = 0; r < o.rounds; r++) repeated.push(...orderTargets(o.targets as TargetSpec[], o.order, rng));
      return {
        name: o.name,
        targets: repeated,
        progression: o.progression,
        dartsPerTarget: o.dartsPerTarget,
        maxDartsPerTarget: o.maxDartsPerTarget,
        goalPercent: o.goalPercent,
      };
    }
    case "checkout_training": {
      const o = parsed.data as ModeOptions<"checkout_training">;
      let targets: number[];
      if (o.selection === "list") {
        if (!o.values || o.values.length === 0) throw new ModeConfigError("Saisissez au moins un score à terminer.");
        const impossible = o.values.filter((v) => !canCheckout(v, o.outRule, 3));
        if (impossible.length) {
          throw new ModeConfigError(`Score(s) impossible(s) à terminer en 3 fléchettes : ${impossible.join(", ")}.`);
        }
        targets = o.values;
      } else {
        const low = Math.min(o.min, o.max);
        const high = Math.max(o.min, o.max);
        const pool: number[] = [];
        for (let v = low; v <= high; v++) if (canCheckout(v, o.outRule, 3)) pool.push(v);
        if (pool.length === 0) throw new ModeConfigError("Aucun score terminable dans cet intervalle.");
        targets = Array.from({ length: o.count }, () => pool[Math.floor(rng() * pool.length)] as number);
      }
      return { targets, visitsPerTarget: o.visitsPerTarget, outRule: o.outRule };
    }
    default:
      return parsed.data;
  }
}
