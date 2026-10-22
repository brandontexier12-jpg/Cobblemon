import { eventDef, seasonCalendar, type Category, type EventDef, type StageFormat } from "./catalogue.js";
import { generateIdentity } from "./names.js";
import { Rng } from "./rng.js";
import { simulateMatch } from "./sim.js";

/**
 * Moteur du mode carrière (sans base de données : il transforme un état JSON).
 *
 * Une saison suit le calendrier réel. À chaque tournoi, le tableau est composé selon les règles
 * d'accès (classements, Tour Card…). Si le joueur en fait partie, ses matchs se jouent pour de vrai
 * dans l'application contre le bot correspondant ; tous les autres matchs sont simulés. Les gains
 * alimentent les classements (Order of Merit sur deux saisons, classements de la saison), qui
 * décident des invitations aux tournois suivants et du maintien de la Tour Card.
 */

export type Difficulty = "debutant" | "amateur" | "semi_pro" | "pro" | "legende";
export type MatchLength = "reelle" | "raccourcie" | "courte";

export const HUMAN = "me";
export const TOUR_CARDS = 128;

export const DIFFICULTIES: Record<Difficulty, { label: string; hint: string; card: [number, number]; amateurs: [number, number] }> = {
  debutant: { label: "Débutant", hint: "Pros entre 48 et 80 de moyenne", card: [48, 80], amateurs: [30, 55] },
  amateur: { label: "Amateur", hint: "Pros entre 58 et 90 de moyenne", card: [58, 90], amateurs: [40, 66] },
  semi_pro: { label: "Semi-pro", hint: "Pros entre 68 et 98 de moyenne", card: [68, 98], amateurs: [50, 76] },
  pro: { label: "Pro (réaliste)", hint: "Pros entre 84 et 106 de moyenne, comme sur le vrai circuit", card: [84, 106], amateurs: [62, 86] },
  legende: { label: "Légende", hint: "Pros entre 92 et 114 de moyenne", card: [92, 114], amateurs: [74, 95] },
};

export interface CareerSettings {
  difficulty: Difficulty;
  outRule: "single" | "double";
  matchLength: MatchLength;
  /** Calendrier allégé : moins de Players Championships et d'étapes de l'European Tour. */
  light: boolean;
  start: "qschool" | "tourcard";
}

export interface CircuitPlayer {
  id: string;
  name: string;
  nickname: string;
  country: string;
  /** Moyenne sur 3 fléchettes (niveau du bot). */
  rating: number;
  age: number;
  card: boolean;
  /** Dernière saison couverte par la Tour Card. */
  cardUntil: number | null;
  titles: number;
  human?: boolean;
  retired?: boolean;
}

export interface Fixture {
  a: string | null;
  b: string | null;
  format: StageFormat;
  sa?: number;
  sb?: number;
  avgA?: number;
  avgB?: number;
  winner?: string;
  bye?: boolean;
}

export interface Group {
  name: string;
  players: string[];
  rounds: Fixture[][];
}

export interface Run {
  key: string;
  eventId: string;
  field: string[];
  phase: "groups" | "knockout";
  groups: Group[];
  groupRound: number;
  rounds: Fixture[][];
  /** Nombre total de tours du tableau final. */
  koRounds: number;
  /** Tour (0 = premier) où chaque joueur a été éliminé du tableau final ; vainqueur absent. */
  outAt: Record<string, number>;
  /** Phase de groupes : place des éliminés (0 = première place non qualificative). */
  groupOut: Record<string, number>;
}

export interface FixtureRef {
  phase: "groups" | "knockout";
  group: number;
  round: number;
  index: number;
}

export interface HumanResult {
  won: boolean;
  /** Score du joueur et du bot (sets, ou legs sans sets). */
  me: number;
  opp: number;
}

export type Pending =
  | { kind: "match"; ref: FixtureRef; opponent: string; matchId: string | null; humanFirst: boolean; result: HumanResult | null }
  | { kind: "event"; key: string }
  | { kind: "season"; season: number }
  | null;

export interface EventResult {
  key: string;
  season: number;
  eventId: string;
  winner: string;
  runnerUp: string;
  final: string;
  /** Résultat du joueur (null s'il n'était pas dans le tableau). */
  human: { label: string; stage: number; prize: number; card?: boolean } | null;
}

export interface SeasonSummary {
  season: number;
  humanRank: number | null;
  humanMoney: number;
  humanTitles: string[];
  top: { id: string; money: number }[];
  notes: string[];
}

export interface CareerState {
  v: 1;
  rng: number;
  settings: CareerSettings;
  season: number;
  calendar: string[];
  eventIndex: number;
  players: CircuitPlayer[];
  /** Gains par joueur, saison et classement. */
  earnings: Record<string, Record<string, Partial<Record<Category, number>>>>;
  history: EventResult[];
  seasons: SeasonSummary[];
  run: Run | null;
  pending: Pending;
  /** Historique à partir duquel afficher « pendant ce temps » (tournois simulés depuis le dernier arrêt). */
  feedFrom: number;
  /** Joueur de la base (bot) correspondant à chaque adversaire déjà affronté. */
  bots?: Record<string, string>;
}

// ---------- Création ----------

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export function createCareer(
  seed: number,
  settings: CareerSettings,
  human: { name: string; country: string; rating: number },
  season: number,
): CareerState {
  const rng = new Rng(seed);
  const range = DIFFICULTIES[settings.difficulty];
  const taken = new Set<string>([human.name.toLowerCase()]);
  const players: CircuitPlayer[] = [];
  // 128 détenteurs de Tour Card : peu de joueurs d'élite, beaucoup de joueurs de milieu de tableau.
  for (let r = 0; r < TOUR_CARDS; r++) {
    const [lo, hi] = range.card;
    const rating = clamp(hi - (hi - lo) * (r / (TOUR_CARDS - 1)) ** 0.6 + rng.normal(0, 1.5), lo - 4, hi + 2);
    const id = generateIdentity(rng, taken);
    players.push({ id: `p${players.length + 1}`, ...id, rating: round1(rating), age: rng.int(21, 46), card: true, cardUntil: season + rng.int(0, 1), titles: 0 });
  }
  // Joueurs sans carte (Q-School, Challenge Tour, WDF, qualifiés locaux).
  for (let r = 0; r < 140; r++) {
    const [lo, hi] = range.amateurs;
    const id = generateIdentity(rng, taken);
    players.push({ id: `p${players.length + 1}`, ...id, rating: round1(clamp(rng.normal((lo + hi) / 2, (hi - lo) / 4), lo - 6, hi + 3)), age: rng.int(18, 50), card: false, cardUntil: null, titles: 0 });
  }
  const withCard = settings.start === "tourcard";
  players.push({
    id: HUMAN,
    name: human.name,
    nickname: "",
    country: human.country,
    rating: human.rating,
    age: 0,
    card: withCard,
    cardUntil: withCard ? season + 1 : null,
    titles: 0,
    human: true,
  });
  const state: CareerState = {
    v: 1,
    rng: rng.state,
    settings,
    season,
    calendar: seasonCalendar(settings.light).map((e) => e.id),
    eventIndex: 0,
    players,
    earnings: {},
    history: [],
    seasons: [],
    run: null,
    pending: null,
    feedFrom: 0,
  };
  // Gains de la saison précédente : l'Order of Merit existe dès le premier tournoi.
  const byLevel = players.filter((p) => p.card && !p.human).sort((x, y) => y.rating - x.rating + rng.normal(0, 1.2));
  byLevel.forEach((p, r) => addMoney(state, p.id, season - 1, ["pdc"], Math.round((1_400_000 * Math.exp(-r / 14) + 20_000 * (1 - r / TOUR_CARDS)) / 250) * 250));
  state.rng = rng.state;
  return state;
}

// ---------- Classements ----------

function addMoney(state: CareerState, id: string, season: number, cats: Category[], amount: number): void {
  if (amount <= 0 || cats.length === 0) return;
  const bySeason = (state.earnings[id] ??= {});
  const entry = (bySeason[String(season)] ??= {});
  for (const c of cats) entry[c] = (entry[c] ?? 0) + amount;
}

export function moneyOf(state: CareerState, id: string, cat: Category, season = state.season): number {
  const bySeason = state.earnings[id];
  if (!bySeason) return 0;
  // Order of Merit PDC : gains sur deux saisons ; les autres classements portent sur la saison.
  const seasons = cat === "pdc" ? [season, season - 1] : [season];
  return seasons.reduce((s, y) => s + (bySeason[String(y)]?.[cat] ?? 0), 0);
}

export function playerById(state: CareerState): Map<string, CircuitPlayer> {
  return new Map(state.players.map((p) => [p.id, p]));
}

/** Classement (gains décroissants, puis niveau). */
export function ranking(state: CareerState, cat: Category, filter: (p: CircuitPlayer) => boolean = () => true): { id: string; money: number }[] {
  return state.players
    .filter((p) => !p.retired && filter(p))
    .map((p) => ({ id: p.id, money: moneyOf(state, p.id, cat), rating: p.rating }))
    .sort((a, b) => b.money - a.money || b.rating - a.rating)
    .map(({ id, money }) => ({ id, money }));
}

/** Rang du joueur dans l'Order of Merit PDC (null s'il n'a rien gagné). */
export function humanRank(state: CareerState, cat: Category = "pdc"): number | null {
  const list = ranking(state, cat).filter((r) => r.money > 0);
  const i = list.findIndex((r) => r.id === HUMAN);
  return i < 0 ? null : i + 1;
}

// ---------- Composition des tableaux ----------

function takeUnique(target: string[], ids: string[], n: number): void {
  for (const id of ids) {
    if (target.length >= n) return;
    if (!target.includes(id)) target.push(id);
  }
}

/** Joueurs du tableau, du mieux classé au moins bien classé (les têtes de série en premier). */
export function buildField(state: CareerState, def: EventDef, rng: Rng): string[] {
  const active = state.players.filter((p) => !p.retired);
  const card = (p: CircuitPlayer) => p.card;
  const noCard = (p: CircuitPlayer) => !p.card;
  const pdc = ranking(state, "pdc").map((r) => r.id);
  const pdcCard = ranking(state, "pdc", card).map((r) => r.id);
  const byForm = (list: CircuitPlayer[], spread: number) =>
    list
      .map((p) => ({ id: p.id, v: p.rating + rng.normal(0, spread) }))
      .sort((a, b) => b.v - a.v)
      .map((x) => x.id);
  const human = active.find((p) => p.human)!;
  const field: string[] = [];
  const e = def.entry;
  switch (e.kind) {
    case "tourcard": {
      takeUnique(field, pdcCard, def.field - e.amateurs);
      const amateurs = byForm(active.filter((p) => noCard(p) && !p.human), 6);
      if (e.amateurs > 0 && !human.card) field.push(HUMAN);
      takeUnique(field, amateurs, def.field);
      break;
    }
    case "pdc_top":
      takeUnique(field, pdc, e.n);
      break;
    case "split":
      takeUnique(field, pdc, e.pdc);
      takeUnique(field, ranking(state, e.other, card).filter((r) => r.money > 0).map((r) => r.id), e.n);
      takeUnique(field, pdcCard, e.n);
      break;
    case "ranking":
      takeUnique(field, ranking(state, e.by).filter((r) => r.money > 0).map((r) => r.id), e.n);
      takeUnique(field, pdcCard, e.n);
      break;
    case "eurotour": {
      takeUnique(field, pdcCard, 16);
      const qualifiers = byForm(active.filter((p) => card(p) && !p.human && !field.includes(p.id)), 8);
      const q: string[] = human.card && !field.includes(HUMAN) ? [HUMAN] : [];
      takeUnique(q, qualifiers, 32);
      field.push(...rng.shuffle(q));
      break;
    }
    case "worldseries":
      takeUnique(field, pdc, 8);
      takeUnique(field, byForm(active.filter((p) => noCard(p) && !p.human), 6), 16);
      break;
    case "grandslam": {
      takeUnique(field, pdc, 16);
      const winners = state.history
        .filter((h) => h.season === state.season && ["players", "eurotour", "major", "worldseries"].includes(eventDef(h.eventId).tier))
        .map((h) => h.winner);
      takeUnique(field, pdc.filter((id) => winners.includes(id)), 24);
      takeUnique(field, ranking(state, "challenge", noCard).filter((r) => r.money > 0).map((r) => r.id).slice(0, 2), 26);
      takeUnique(field, pdc, 32);
      break;
    }
    case "worlds": {
      takeUnique(field, pdcCard, 40);
      takeUnique(field, ranking(state, "protour", card).filter((r) => r.money > 0).map((r) => r.id), 88);
      takeUnique(field, ranking(state, "challenge", noCard).filter((r) => r.money > 0).map((r) => r.id).slice(0, 4), 92);
      takeUnique(field, ranking(state, "wdf", noCard).filter((r) => r.money > 0).map((r) => r.id).slice(0, 4), 96);
      takeUnique(field, pdcCard, 104);
      // Qualifications internationales : les meilleurs amateurs du moment.
      takeUnique(field, byForm(active.filter((p) => noCard(p) && !p.human), 6), 128);
      break;
    }
    case "amateurs": {
      if (!human.card) field.push(HUMAN);
      takeUnique(field, byForm(active.filter((p) => noCard(p) && !p.human), 5), e.n);
      // Tableau trié par niveau pour les têtes de série (le joueur n'est pas tête de série).
      const rest = field.filter((id) => id !== HUMAN);
      const level = playerById(state);
      rest.sort((a, b) => level.get(b)!.rating - level.get(a)!.rating);
      return human.card ? rest : [...rest, HUMAN];
    }
    case "wdf_top":
      takeUnique(field, ranking(state, "wdf", noCard).filter((r) => r.money > 0).map((r) => r.id), e.n);
      takeUnique(field, byForm(active.filter((p) => noCard(p) && !p.human), 6), e.n);
      break;
  }
  return field.slice(0, def.field);
}

// ---------- Tableaux ----------

/** Positions du tableau : tête de série n°1 et n°2 ne peuvent se rencontrer qu'en finale. */
export function bracketOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order.slice(0, size);
}

export function scaleFormat(format: StageFormat, length: MatchLength): StageFormat {
  if (length === "reelle") return format;
  const div = length === "raccourcie" ? 2 : 3;
  if (format.sets && format.sets > 1) {
    const sets = Math.max(1, Math.ceil(format.sets / div));
    return sets > 1 ? { sets, legs: 2 } : { legs: 2 };
  }
  return { legs: Math.max(1, Math.ceil(format.legs / div)) };
}

function koFormat(def: EventDef, round: number, koRounds: number, length: MatchLength): StageFormat {
  const fromFinal = koRounds - 1 - round;
  return scaleFormat(def.rounds[Math.min(fromFinal, def.rounds.length - 1)]!, length);
}

function firstRound(def: EventDef, seeded: (string | null)[], koRounds: number, length: MatchLength): Fixture[] {
  const size = 2 ** koRounds;
  const order = bracketOrder(size);
  const fixtures: Fixture[] = [];
  for (let i = 0; i < size; i += 2) {
    const a = seeded[order[i]! - 1] ?? null;
    const b = seeded[order[i + 1]! - 1] ?? null;
    const f: Fixture = { a, b, format: koFormat(def, 0, koRounds, length) };
    if (!a || !b) {
      f.bye = true;
      f.winner = (a ?? b) ?? undefined;
    }
    fixtures.push(f);
  }
  return fixtures;
}

function roundRobin(players: string[]): [string, string][][] {
  const list: (string | null)[] = [...players];
  if (list.length % 2) list.push(null);
  const n = list.length;
  const rounds: [string, string][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i];
      const b = list[n - 1 - i];
      if (a && b) pairs.push(r % 2 ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    list.splice(1, 0, list.pop()!);
  }
  return rounds;
}

export function createRun(state: CareerState, def: EventDef, field: string[], rng: Rng): Run {
  const length = state.settings.matchLength;
  const run: Run = {
    key: `${state.season}-${def.id}`,
    eventId: def.id,
    field,
    phase: "knockout",
    groups: [],
    groupRound: 0,
    rounds: [],
    koRounds: 0,
    outAt: {},
    groupOut: {},
  };
  const s = def.structure;
  if (s.kind === "groups" || s.kind === "league") {
    const count = s.kind === "groups" ? s.groups : 1;
    const groups: string[][] = Array.from({ length: count }, () => []);
    // Chapeaux : une tête de série par poule, puis tirage au sort chapeau par chapeau.
    for (let pot = 0; pot * count < field.length; pot++) {
      const members = rng.shuffle(field.slice(pot * count, pot * count + count));
      members.forEach((id, g) => groups[g]!.push(id));
    }
    const format = scaleFormat(s.format, length);
    run.phase = "groups";
    run.groups = groups.map((players, g) => ({
      name: count === 1 ? "Ligue" : `Groupe ${String.fromCharCode(65 + g)}`,
      players,
      rounds: roundRobin(players).map((pairs) => pairs.map(([a, b]) => ({ a, b, format }))),
    }));
    run.koRounds = Math.log2((s.kind === "groups" ? s.groups * s.advance : s.advance));
    return run;
  }
  const koRounds = Math.ceil(Math.log2(field.length));
  const size = 2 ** koRounds;
  const byes = size - field.length;
  const seeds = Math.max(size >= 32 ? size / 4 : size / 2, byes);
  const seeded: (string | null)[] = [...field.slice(0, seeds), ...rng.shuffle(field.slice(seeds)), ...Array(byes).fill(null)];
  run.koRounds = koRounds;
  run.rounds = [firstRound(def, seeded, koRounds, length)];
  return run;
}

/** Classement d'une poule : victoires, différence de legs, legs gagnés, niveau. */
export function groupTable(state: CareerState, group: Group): { id: string; played: number; won: number; legDiff: number; legsFor: number }[] {
  const rows = new Map(group.players.map((id) => [id, { id, played: 0, won: 0, legDiff: 0, legsFor: 0 }]));
  for (const f of group.rounds.flat()) {
    if (!f.winner || !f.a || !f.b) continue;
    const ra = rows.get(f.a)!;
    const rb = rows.get(f.b)!;
    ra.played++;
    rb.played++;
    ra.legsFor += f.sa ?? 0;
    rb.legsFor += f.sb ?? 0;
    ra.legDiff += (f.sa ?? 0) - (f.sb ?? 0);
    rb.legDiff += (f.sb ?? 0) - (f.sa ?? 0);
    (f.winner === f.a ? ra : rb).won++;
  }
  const level = playerById(state);
  return [...rows.values()].sort((x, y) => y.won - x.won || y.legDiff - x.legDiff || y.legsFor - x.legsFor || level.get(y.id)!.rating - level.get(x.id)!.rating);
}

function knockoutFromGroups(state: CareerState, def: EventDef, run: Run): Fixture[] {
  const s = def.structure;
  const advance = s.kind === "groups" ? s.advance : s.kind === "league" ? s.advance : 0;
  const tables = run.groups.map((g) => groupTable(state, g));
  tables.forEach((t) => t.slice(advance).forEach((row, i) => (run.groupOut[row.id] = i)));
  const format = koFormat(def, 0, run.koRounds, state.settings.matchLength);
  if (tables.length === 1) {
    // Ligue : 1er contre dernier qualifié, 2e contre l'avant-dernier…
    const q = tables[0]!.slice(0, advance).map((r) => r.id);
    const order = bracketOrder(advance);
    const fixtures: Fixture[] = [];
    for (let i = 0; i < advance; i += 2) fixtures.push({ a: q[order[i]! - 1]!, b: q[order[i + 1]! - 1]!, format });
    return fixtures;
  }
  // Poules : vainqueur d'une poule contre deuxième de la poule voisine.
  const fixtures: Fixture[] = [];
  for (let g = 0; g < tables.length; g += 2) {
    const [x, y] = [tables[g]!, tables[g + 1]!];
    fixtures.push({ a: x[0]!.id, b: y[1]!.id, format }, { a: y[0]!.id, b: x[1]!.id, format });
  }
  return fixtures;
}

// ---------- Déroulement ----------

function humanIn(f: Fixture): boolean {
  return f.a === HUMAN || f.b === HUMAN;
}

function simulate(state: CareerState, def: EventDef, f: Fixture, rng: Rng): void {
  if (f.winner || !f.a || !f.b) return;
  const level = playerById(state);
  const r = simulateMatch(rng, level.get(f.a)!.rating, level.get(f.b)!.rating, f.format, state.settings.outRule, def.doubleIn && state.settings.outRule === "double");
  f.sa = r.scoreA;
  f.sb = r.scoreB;
  f.avgA = r.avgA;
  f.avgB = r.avgB;
  f.winner = r.winner === "a" ? f.a : f.b;
}

function currentFixtures(run: Run): { fixtures: Fixture[]; refs: FixtureRef[] } {
  const fixtures: Fixture[] = [];
  const refs: FixtureRef[] = [];
  if (run.phase === "groups") {
    run.groups.forEach((g, gi) =>
      (g.rounds[run.groupRound] ?? []).forEach((f, index) => {
        fixtures.push(f);
        refs.push({ phase: "groups", group: gi, round: run.groupRound, index });
      }),
    );
  } else {
    const round = run.rounds.length - 1;
    run.rounds[round]!.forEach((f, index) => {
      fixtures.push(f);
      refs.push({ phase: "knockout", group: 0, round, index });
    });
  }
  return { fixtures, refs };
}

export function fixtureAt(run: Run, ref: FixtureRef): Fixture {
  return ref.phase === "groups" ? run.groups[ref.group]!.rounds[ref.round]![ref.index]! : run.rounds[ref.round]![ref.index]!;
}

/**
 * Fait avancer le tournoi en cours jusqu'au prochain match du joueur (« human ») ou jusqu'à la fin
 * (« done »).
 */
function stepRun(state: CareerState, def: EventDef, rng: Rng): "human" | "done" {
  const run = state.run!;
  for (;;) {
    if (run.phase === "groups") {
      const roundsCount = Math.max(...run.groups.map((g) => g.rounds.length));
      if (run.groupRound >= roundsCount) {
        run.phase = "knockout";
        run.rounds = [knockoutFromGroups(state, def, run)];
        continue;
      }
    }
    const { fixtures, refs } = currentFixtures(run);
    const mine = fixtures.findIndex((f) => !f.winner && humanIn(f));
    if (mine >= 0) {
      const f = fixtures[mine]!;
      const opponent = f.a === HUMAN ? f.b! : f.a!;
      if (state.pending?.kind !== "match") {
        state.pending = { kind: "match", ref: refs[mine]!, opponent, matchId: null, humanFirst: rng.next() < 0.5, result: null };
      }
      return "human";
    }
    for (const f of fixtures) simulate(state, def, f, rng);
    if (run.phase === "groups") {
      run.groupRound++;
      continue;
    }
    const round = run.rounds.length - 1;
    for (const f of fixtures) {
      const loser = f.a === f.winner ? f.b : f.a;
      if (loser) run.outAt[loser] = round;
    }
    if (fixtures.length === 1) return "done";
    const next: Fixture[] = [];
    const format = koFormat(def, round + 1, run.koRounds, state.settings.matchLength);
    for (let i = 0; i < fixtures.length; i += 2) next.push({ a: fixtures[i]!.winner ?? null, b: fixtures[i + 1]!.winner ?? null, format });
    run.rounds.push(next);
  }
}

const STAGE_LABELS = ["Vainqueur", "Finaliste", "Demi-finale", "Quart de finale", "Huitième de finale", "Seizième de finale", "32e de finale", "64e de finale", "128e de finale"];

export function stageLabel(stage: number): string {
  return STAGE_LABELS[stage] ?? `${2 ** stage}e de finale`;
}

export function roundName(playersInRound: number): string {
  if (playersInRound === 2) return "Finale";
  if (playersInRound === 4) return "Demi-finales";
  if (playersInRound === 8) return "Quarts de finale";
  if (playersInRound === 16) return "Huitièmes de finale";
  if (playersInRound === 32) return "Seizièmes de finale";
  return `${playersInRound / 2}es de finale`;
}

/** Fin d'un tournoi : dotations, titres, Tour Cards de la Q-School, historique. */
function finishRun(state: CareerState, def: EventDef): EventResult {
  const run = state.run!;
  const final = run.rounds[run.rounds.length - 1]![0]!;
  const winner = final.winner!;
  const runnerUp = final.a === winner ? final.b! : final.a!;
  const prizeOf = (id: string): { stage: number; prize: number; label: string } => {
    if (id === winner) return { stage: 0, prize: def.prize[0] ?? 0, label: stageLabel(0) };
    if (id in run.outAt) {
      const stage = run.koRounds - run.outAt[id]!;
      return { stage, prize: def.prize[stage] ?? 0, label: stageLabel(stage) };
    }
    const place = run.groupOut[id] ?? 0;
    const advance = def.structure.kind === "knockout" ? 0 : def.structure.advance;
    return { stage: 99, prize: def.groupPrize?.[place] ?? 0, label: def.structure.kind === "league" ? `Ligue (${advance + place + 1}e)` : `Phase de groupes (${advance + place + 1}e)` };
  };
  for (const id of run.field) {
    const p = prizeOf(id);
    addMoney(state, id, state.season, def.counts, p.prize);
  }
  const level = playerById(state);
  level.get(winner)!.titles++;
  let humanCard = false;
  if (def.tourCards) {
    // Q-School : places libres sur le circuit (au moins `tourCards`), attribuées selon le résultat.
    const holders = state.players.filter((p) => p.card && !p.retired).length;
    const cards = Math.max(def.tourCards, TOUR_CARDS - holders);
    const order = run.field
      .map((id) => ({ id, stage: prizeOf(id).stage, rating: level.get(id)!.rating, human: id === HUMAN }))
      .sort((a, b) => a.stage - b.stage || Number(b.human) - Number(a.human) || b.rating - a.rating)
      .slice(0, cards);
    for (const o of order) {
      const p = level.get(o.id)!;
      p.card = true;
      p.cardUntil = state.season + 1;
      if (o.human) humanCard = true;
    }
  }
  const scoreText = (f: Fixture) => `${f.a === winner ? f.sa : f.sb}-${f.a === winner ? f.sb : f.sa}`;
  const entered = run.field.includes(HUMAN);
  const result: EventResult = {
    key: run.key,
    season: state.season,
    eventId: def.id,
    winner,
    runnerUp,
    final: scoreText(final),
    human: entered ? { ...prizeOf(HUMAN), ...(def.tourCards ? { card: humanCard } : {}) } : null,
  };
  state.history.push(result);
  state.run = null;
  return result;
}

// ---------- Fin de saison ----------

function endSeason(state: CareerState, rng: Rng): void {
  const season = state.season;
  const level = playerById(state);
  const pdc = ranking(state, "pdc");
  const rankOf = new Map(pdc.map((r, i) => [r.id, i + 1]));
  const notes: string[] = [];
  const human = level.get(HUMAN)!;
  const summary: SeasonSummary = {
    season,
    humanRank: humanRank(state),
    humanMoney: moneyOf(state, HUMAN, "pdc"),
    humanTitles: state.history.filter((h) => h.season === season && h.winner === HUMAN).map((h) => eventDef(h.eventId).name),
    top: pdc.slice(0, 16),
    notes,
  };
  // Tour Cards : renouvelées dans le top 64 de l'Order of Merit, perdues sinon.
  for (const p of state.players) {
    if (!p.card || p.retired || (p.cardUntil ?? 0) > season) continue;
    if ((rankOf.get(p.id) ?? 999) <= 64) p.cardUntil = season + 2;
    else {
      p.card = false;
      p.cardUntil = null;
      if (p.human) notes.push("Tour Card perdue (hors du top 64 de l'Order of Merit) : retour à la Q-School.");
    }
  }
  if (human.card && human.cardUntil === season + 2 && (rankOf.get(HUMAN) ?? 999) <= 64) notes.push("Tour Card renouvelée pour deux saisons (top 64 de l'Order of Merit).");
  // Challenge Tour : les deux premiers obtiennent une Tour Card.
  for (const r of ranking(state, "challenge", (p) => !p.card).filter((r) => r.money > 0).slice(0, 2)) {
    const p = level.get(r.id)!;
    p.card = true;
    p.cardUntil = season + 2;
    if (p.human) notes.push("Tour Card obtenue grâce au classement du Challenge Tour.");
  }
  // Évolution des joueurs : progression des jeunes, déclin avec l'âge, retraites remplacées par des jeunes.
  const range = DIFFICULTIES[state.settings.difficulty];
  const taken = new Set(state.players.map((p) => p.name.toLowerCase()));
  for (const p of state.players) {
    if (p.human || p.retired) continue;
    p.age++;
    const drift = p.age < 25 ? rng.normal(1.6, 1.4) : p.age < 33 ? rng.normal(0.3, 1.2) : p.age < 41 ? rng.normal(-0.5, 1.2) : rng.normal(-1.3, 1.2);
    p.rating = round1(clamp(p.rating + drift, range.amateurs[0] - 8, range.card[1] + 3));
    if (!p.card && (p.age >= 52 || (p.age >= 45 && rng.next() < 0.25))) {
      p.retired = true;
      const id = generateIdentity(rng, taken);
      const [lo, hi] = range.amateurs;
      state.players.push({ id: `p${state.players.length + 1}`, ...id, rating: round1(clamp(rng.normal((lo + hi) / 2 - 3, (hi - lo) / 4), lo - 6, hi)), age: rng.int(17, 22), card: false, cardUntil: null, titles: 0 });
    }
  }
  state.seasons.push(summary);
  // Seules les deux dernières saisons comptent : les gains plus anciens sont élagués.
  for (const bySeason of Object.values(state.earnings)) {
    for (const y of Object.keys(bySeason)) if (Number(y) < season) delete bySeason[y];
  }
  state.season = season + 1;
  state.calendar = seasonCalendar(state.settings.light).map((e) => e.id);
  state.eventIndex = 0;
  state.run = null;
}

// ---------- Avancement ----------

/** Résultat du match réel du joueur, appliqué au tableau. */
function applyHumanResult(state: CareerState, pending: Extract<Pending, { kind: "match" }>): void {
  const f = fixtureAt(state.run!, pending.ref);
  const r = pending.result!;
  const meIsA = f.a === HUMAN;
  f.sa = meIsA ? r.me : r.opp;
  f.sb = meIsA ? r.opp : r.me;
  f.winner = r.won ? HUMAN : pending.opponent;
}

/**
 * Avance la carrière jusqu'au prochain arrêt : un match à jouer, la fin d'un tournoi où le joueur
 * était engagé, ou la fin de la saison. Les tournois sans le joueur sont simulés en chemin.
 */
export function advance(state: CareerState): CareerState {
  const rng = new Rng(state.rng);
  state.feedFrom = state.history.length;
  for (let guard = 0; guard < 200; guard++) {
    const pending = state.pending;
    if (pending?.kind === "match") {
      if (!pending.result) break;
      applyHumanResult(state, pending);
      state.pending = null;
    } else if (pending?.kind === "event") {
      state.pending = null;
      state.feedFrom = state.history.length;
    } else if (pending?.kind === "season") {
      endSeason(state, rng);
      state.pending = null;
      state.feedFrom = state.history.length;
    }
    if (state.run) {
      const def = eventDef(state.run.eventId);
      if (stepRun(state, def, rng) === "human") break;
      const result = finishRun(state, def);
      if (result.human) {
        state.pending = { kind: "event", key: result.key };
        break;
      }
      continue;
    }
    if (state.eventIndex >= state.calendar.length) {
      state.pending = { kind: "season", season: state.season };
      break;
    }
    const def = eventDef(state.calendar[state.eventIndex]!);
    state.eventIndex++;
    state.run = createRun(state, def, buildField(state, def, rng), rng);
  }
  state.rng = rng.state;
  return state;
}

/** Format du match réel en cours (pour créer la partie X01). */
export function pendingMatchFormat(state: CareerState): { format: StageFormat; doubleIn: boolean } | null {
  const p = state.pending;
  if (p?.kind !== "match" || !state.run) return null;
  const def = eventDef(state.run.eventId);
  return { format: fixtureAt(state.run, p.ref).format, doubleIn: !!def.doubleIn && state.settings.outRule === "double" };
}

/** Intitulé du tour du match en cours (« Quarts de finale », « Groupe B — journée 2 »…). */
export function pendingRoundLabel(state: CareerState): string | null {
  const p = state.pending;
  if (p?.kind !== "match" || !state.run) return null;
  const run = state.run;
  if (p.ref.phase === "groups") {
    const g = run.groups[p.ref.group]!;
    return `${g.name} — journée ${p.ref.round + 1}`;
  }
  const playersInRound = 2 ** (run.koRounds - p.ref.round);
  return roundName(playersInRound);
}
