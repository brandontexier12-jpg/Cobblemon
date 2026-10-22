/**
 * Calendrier du mode carrière : les tournois réels du circuit (PDC, Challenge Tour, WDF), dans
 * l'ordre d'une saison. Lieux, mois, tableaux, formats et dotations reprennent ceux des éditions
 * récentes, arrondis (dotations en livres sterling) ; quelques simplifications sont indiquées.
 * La Coupe du monde par équipes (World Cup of Darts) n'est pas proposée : elle se joue en double.
 */

/** Classements alimentés par les gains. */
export type Category = "pdc" | "protour" | "pc" | "eurotour" | "ws" | "challenge" | "wdf";

export type Tier = "qschool" | "challenge" | "wdf" | "players" | "eurotour" | "worldseries" | "premier" | "major";

/** Composition du tableau. */
export type Entry =
  /** Tous les détenteurs d'une Tour Card, plus `amateurs` qualifiés (le joueur sans carte y entre par les qualifications amateurs). */
  | { kind: "tourcard"; amateurs: number }
  /** Les `n` premiers de l'Order of Merit PDC. */
  | { kind: "pdc_top"; n: number }
  /** Les `pdc` premiers de l'Order of Merit PDC, complétés par les meilleurs du classement `other` (Pro Tour). */
  | { kind: "split"; pdc: number; other: Category; n: number }
  /** Les `n` premiers d'un classement de la saison (European Tour, Players Championship…). */
  | { kind: "ranking"; by: Category; n: number }
  /** European Tour : 16 têtes de série (Order of Merit) et 32 qualifiés parmi les détenteurs de carte. */
  | { kind: "eurotour" }
  /** World Series : 8 invités (Order of Merit) et 8 joueurs locaux. */
  | { kind: "worldseries" }
  /** Grand Slam : 16 premiers de l'Order of Merit, vainqueurs de la saison, puis classement. */
  | { kind: "grandslam" }
  /** Championnat du monde PDC : 128 joueurs (classements et qualifications). */
  | { kind: "worlds" }
  /** Joueurs sans Tour Card (Q-School, Challenge Tour, opens WDF). */
  | { kind: "amateurs"; n: number }
  /** Les `n` premiers du classement WDF (joueurs sans Tour Card). */
  | { kind: "wdf_top"; n: number };

/** Premier à `legs` legs (par set si `sets`), premier à `sets` sets. */
export interface StageFormat {
  legs: number;
  sets?: number;
}

export type Structure =
  | { kind: "knockout" }
  /** Poules (toutes rencontres), les `advance` premiers de chaque poule vont en tableau final. */
  | { kind: "groups"; groups: number; size: number; advance: number; format: StageFormat }
  /** Ligue unique (toutes rencontres) puis phase finale à `advance`. */
  | { kind: "league"; advance: number; format: StageFormat };

export interface EventDef {
  id: string;
  name: string;
  venue: string;
  city: string;
  /** Mois (1 à 12). */
  month: number;
  /** Période affichée quand le tournoi s'étale sur plusieurs mois. */
  period?: string;
  tier: Tier;
  /** Taille du tableau. */
  field: number;
  entry: Entry;
  structure: Structure;
  /** Formats du tableau final, de la finale vers les premiers tours (le dernier se répète). */
  rounds: StageFormat[];
  /** Dotation par résultat : vainqueur, finaliste, demi, quart, 16es, 32es, 64es, 128es, 256es. */
  prize: number[];
  /** Phase de poules ou de ligue : dotation des éliminés selon leur place (à partir de la première place non qualificative). */
  groupPrize?: number[];
  counts: Category[];
  doubleIn?: boolean;
  /** Q-School : nombre de Tour Cards attribuées (demi-finalistes en priorité). */
  tourCards?: number;
  /** Absent du calendrier allégé. */
  full?: boolean;
}

const ko = { kind: "knockout" } as const;
const PC_PRIZE = [15_000, 8_000, 5_000, 3_500, 2_500, 1_500, 1_000, 0];
const ET_PRIZE = [30_000, 12_000, 8_500, 6_000, 4_000, 2_500, 1_250];
const WS_PRIZE = [20_000, 10_000, 5_000, 3_000, 1_500];
const CT_PRIZE = [3_000, 1_500, 750, 500, 300, 200, 100, 0];

function players(n: number, month: number, city: string, venue: string, full = false): EventDef {
  return {
    id: `pc${n}`,
    name: `Players Championship ${n}`,
    venue,
    city,
    month,
    tier: "players",
    field: 128,
    entry: { kind: "tourcard", amateurs: 0 },
    structure: ko,
    rounds: [{ legs: 8 }, { legs: 6 }],
    prize: PC_PRIZE,
    counts: ["pdc", "protour", "pc"],
    full,
  };
}

function eurotour(id: string, name: string, month: number, city: string, venue: string, full = false): EventDef {
  return {
    id,
    name,
    venue,
    city,
    month,
    tier: "eurotour",
    field: 48,
    entry: { kind: "eurotour" },
    structure: ko,
    rounds: [{ legs: 8 }, { legs: 7 }, { legs: 6 }],
    prize: ET_PRIZE,
    counts: ["pdc", "protour", "eurotour"],
    full,
  };
}

function worldSeries(id: string, name: string, month: number, city: string, venue: string): EventDef {
  return {
    id,
    name,
    venue,
    city,
    month,
    tier: "worldseries",
    field: 16,
    entry: { kind: "worldseries" },
    structure: ko,
    rounds: [{ legs: 8 }, { legs: 7 }, { legs: 6 }],
    prize: WS_PRIZE,
    counts: ["ws"],
  };
}

function challenge(n: number, month: number): EventDef {
  return {
    id: `ct${n}`,
    name: `Challenge Tour ${n}`,
    venue: "Marshall Arena",
    city: "Milton Keynes",
    month,
    tier: "challenge",
    field: 128,
    entry: { kind: "amateurs", n: 128 },
    structure: ko,
    rounds: [{ legs: 6 }, { legs: 5 }],
    prize: CT_PRIZE,
    counts: ["challenge"],
  };
}

export const EVENTS: EventDef[] = [
  {
    id: "qschool",
    name: "PDC Q-School",
    venue: "Marshall Arena",
    city: "Milton Keynes",
    month: 1,
    tier: "qschool",
    field: 128,
    entry: { kind: "amateurs", n: 128 },
    structure: ko,
    rounds: [{ legs: 5 }],
    prize: [0],
    counts: [],
    tourCards: 4,
  },
  worldSeries("bahrain", "Bahrain Darts Masters", 1, "Sakhir", "Bahrain International Circuit"),
  worldSeries("dutchmasters", "Dutch Darts Masters", 1, "Leeuwarden", "WTC Expo"),
  {
    id: "masters",
    name: "World Masters",
    venue: "Marshall Arena",
    city: "Milton Keynes",
    month: 2,
    tier: "major",
    field: 32,
    entry: { kind: "pdc_top", n: 32 },
    structure: ko,
    rounds: [{ legs: 11 }, { legs: 11 }, { legs: 10 }, { legs: 10 }, { legs: 6 }],
    prize: [100_000, 50_000, 30_000, 20_000, 10_000, 5_000],
    counts: ["pdc"],
  },
  {
    id: "premier",
    name: "Premier League Darts",
    venue: "The O2 (finale)",
    city: "Londres",
    month: 2,
    period: "février à mai",
    tier: "premier",
    field: 8,
    entry: { kind: "pdc_top", n: 8 },
    // Simplification : une phase de ligue (une rencontre contre chacun) au lieu des 16 soirées.
    structure: { kind: "league", advance: 4, format: { legs: 6 } },
    rounds: [{ legs: 11 }, { legs: 10 }],
    prize: [350_000, 170_000, 85_000],
    groupPrize: [70_000, 65_000, 60_000, 55_000],
    counts: [],
  },
  eurotour("belgian", "Belgian Darts Open", 2, "Wieze", "Oktoberhallen"),
  players(1, 2, "Wigan", "Robin Park Tennis Centre"),
  {
    id: "dutchopen",
    name: "Dutch Open (WDF)",
    venue: "De Bonte Wever",
    city: "Assen",
    month: 2,
    tier: "wdf",
    field: 128,
    entry: { kind: "amateurs", n: 128 },
    structure: ko,
    rounds: [{ legs: 6 }, { legs: 5 }, { legs: 4 }],
    prize: [4_000, 2_000, 1_000, 500, 250, 150],
    counts: ["wdf"],
  },
  {
    id: "ukopen",
    name: "UK Open",
    venue: "Butlin's",
    city: "Minehead",
    month: 3,
    tier: "major",
    field: 160,
    entry: { kind: "tourcard", amateurs: 32 },
    structure: ko,
    rounds: [{ legs: 11 }, { legs: 11 }, { legs: 10 }, { legs: 10 }, { legs: 10 }, { legs: 6 }],
    prize: [120_000, 50_000, 30_000, 20_000, 10_000, 5_000, 2_500, 1_500, 0],
    counts: ["pdc"],
  },
  eurotour("egp", "European Darts Grand Prix", 3, "Sindelfingen", "Glaspalast"),
  players(2, 3, "Leicester", "Morningside Arena"),
  challenge(1, 3),
  eurotour("ido", "International Darts Open", 4, "Riesa", "WT Energiesysteme Arena"),
  eurotour("gdgp", "German Darts Grand Prix", 4, "Munich", "Zenith", true),
  players(3, 4, "Hildesheim", "Halle 39", true),
  eurotour("austrian", "Austrian Darts Open", 5, "Graz", "Messe Congress", true),
  players(4, 5, "Barnsley", "Barnsley Metrodome"),
  challenge(2, 5),
  eurotour("edo", "European Darts Open", 6, "Leverkusen", "Ostermann-Arena", true),
  worldSeries("nordic", "Nordic Darts Masters", 6, "Copenhague", "Forum Copenhagen"),
  worldSeries("usmasters", "US Darts Masters", 6, "New York", "Hulu Theater, Madison Square Garden"),
  eurotour("baltic", "Baltic Sea Darts Open", 7, "Kiel", "Wunderino Arena", true),
  {
    id: "matchplay",
    name: "World Matchplay",
    venue: "Winter Gardens",
    city: "Blackpool",
    month: 7,
    tier: "major",
    field: 32,
    entry: { kind: "split", pdc: 16, other: "protour", n: 32 },
    structure: ko,
    // Simplification : pas d'obligation de gagner avec deux legs d'écart.
    rounds: [{ legs: 18 }, { legs: 17 }, { legs: 16 }, { legs: 11 }, { legs: 10 }],
    prize: [500_000, 250_000, 120_000, 60_000, 35_000, 15_000],
    counts: ["pdc"],
  },
  challenge(3, 7),
  worldSeries("poland", "Poland Darts Masters", 7, "Gliwice", "PreZero Arena"),
  worldSeries("australia", "Australian Darts Masters", 8, "Wollongong", "WIN Entertainment Centre"),
  worldSeries("newzealand", "New Zealand Darts Masters", 8, "Hamilton", "Globox Arena"),
  players(5, 8, "Milton Keynes", "Marshall Arena", true),
  eurotour("flanders", "Flanders Darts Trophy", 8, "Anvers", "Antwerp Expo"),
  eurotour("hungarian", "Hungarian Darts Trophy", 9, "Budapest", "MVM Dome"),
  {
    id: "wsfinals",
    name: "World Series of Darts Finals",
    venue: "AFAS Live",
    city: "Amsterdam",
    month: 9,
    tier: "worldseries",
    field: 24,
    entry: { kind: "ranking", by: "ws", n: 24 },
    structure: ko,
    rounds: [{ legs: 11 }, { legs: 10 }, { legs: 8 }, { legs: 6 }],
    prize: [80_000, 40_000, 20_000, 12_500, 7_500, 5_000],
    counts: ["ws"],
  },
  challenge(4, 9),
  eurotour("gdc", "German Darts Championship", 10, "Hildesheim", "Halle 39"),
  {
    id: "grandprix",
    name: "World Grand Prix",
    venue: "Mattioli Arena",
    city: "Leicester",
    month: 10,
    tier: "major",
    field: 32,
    entry: { kind: "split", pdc: 16, other: "protour", n: 32 },
    structure: ko,
    rounds: [
      { legs: 3, sets: 5 },
      { legs: 3, sets: 4 },
      { legs: 3, sets: 3 },
      { legs: 3, sets: 3 },
      { legs: 3, sets: 2 },
    ],
    prize: [120_000, 60_000, 40_000, 25_000, 15_000, 10_000],
    counts: ["pdc"],
    doubleIn: true,
  },
  {
    id: "eurochamp",
    name: "European Championship",
    venue: "Westfalenhallen",
    city: "Dortmund",
    month: 10,
    tier: "major",
    field: 32,
    entry: { kind: "ranking", by: "eurotour", n: 32 },
    structure: ko,
    rounds: [{ legs: 11 }, { legs: 11 }, { legs: 10 }, { legs: 10 }, { legs: 6 }],
    prize: [120_000, 60_000, 32_000, 22_000, 12_000, 7_000],
    counts: ["pdc"],
  },
  players(6, 10, "Wigan", "Robin Park Tennis Centre"),
  {
    id: "wdfmasters",
    name: "WDF World Masters",
    venue: "Lakeside Country Club",
    city: "Frimley Green",
    month: 10,
    tier: "wdf",
    field: 64,
    entry: { kind: "amateurs", n: 64 },
    structure: ko,
    rounds: [{ legs: 7 }, { legs: 6 }, { legs: 5 }, { legs: 4 }],
    prize: [10_000, 5_000, 2_500, 1_250, 600, 300],
    counts: ["wdf"],
  },
  {
    id: "grandslam",
    name: "Grand Slam of Darts",
    venue: "Aldersley Leisure Village",
    city: "Wolverhampton",
    month: 11,
    tier: "major",
    field: 32,
    entry: { kind: "grandslam" },
    structure: { kind: "groups", groups: 8, size: 4, advance: 2, format: { legs: 5 } },
    rounds: [{ legs: 18 }, { legs: 16 }, { legs: 16 }, { legs: 10 }],
    prize: [150_000, 70_000, 50_000, 25_000, 12_500],
    groupPrize: [8_000, 3_000],
    counts: ["pdc"],
  },
  {
    id: "pcfinals",
    name: "Players Championship Finals",
    venue: "Butlin's",
    city: "Minehead",
    month: 11,
    tier: "major",
    field: 64,
    entry: { kind: "ranking", by: "pc", n: 64 },
    structure: ko,
    rounds: [{ legs: 11 }, { legs: 11 }, { legs: 10 }, { legs: 10 }, { legs: 6 }],
    prize: [120_000, 60_000, 30_000, 20_000, 12_000, 8_500, 5_000],
    counts: ["pdc"],
  },
  {
    id: "wdfworlds",
    name: "WDF World Darts Championship",
    venue: "Lakeside Country Club",
    city: "Frimley Green",
    month: 12,
    tier: "wdf",
    field: 32,
    entry: { kind: "wdf_top", n: 32 },
    structure: ko,
    rounds: [
      { legs: 3, sets: 6 },
      { legs: 3, sets: 5 },
      { legs: 3, sets: 4 },
      { legs: 3, sets: 3 },
      { legs: 3, sets: 2 },
    ],
    prize: [30_000, 12_000, 6_000, 4_000, 2_000, 1_000],
    counts: ["wdf"],
  },
  {
    id: "worlds",
    name: "World Darts Championship",
    venue: "Alexandra Palace",
    city: "Londres",
    month: 12,
    tier: "major",
    field: 128,
    entry: { kind: "worlds" },
    structure: ko,
    rounds: [
      { legs: 3, sets: 7 },
      { legs: 3, sets: 6 },
      { legs: 3, sets: 5 },
      { legs: 3, sets: 4 },
      { legs: 3, sets: 4 },
      { legs: 3, sets: 3 },
    ],
    prize: [1_000_000, 400_000, 200_000, 100_000, 60_000, 35_000, 25_000, 15_000],
    counts: ["pdc"],
  },
];

export const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

export function eventDef(id: string): EventDef {
  const def = EVENTS.find((e) => e.id === id);
  if (!def) throw new Error(`Tournoi inconnu : ${id}`);
  return def;
}

/** Calendrier d'une saison (complet, ou allégé : moins de Players Championships et d'European Tour). */
export function seasonCalendar(light: boolean): EventDef[] {
  return EVENTS.filter((e) => !light || !e.full);
}

export const TIER_LABEL: Record<Tier, string> = {
  qschool: "Q-School",
  challenge: "Challenge Tour",
  wdf: "WDF",
  players: "Pro Tour",
  eurotour: "European Tour",
  worldseries: "World Series",
  premier: "Premier League",
  major: "Majeur",
};
