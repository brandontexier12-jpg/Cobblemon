import { dartScore } from "@darts-evolution/shared";
import {
  canCheckout,
  evaluateOut,
  isOneDartFinish,
  isOpeningDart,
  suggestCheckouts,
  type CheckoutStrategy,
  type InOutRule,
} from "../checkout.js";
import type { ModeRules } from "../types.js";
import { average3, nextIndex } from "./helpers.js";

export interface X01Config {
  startScore: number;
  inRule: InOutRule;
  outRule: InOutRule;
  /** Legs à gagner pour remporter un set (premier à N). */
  legs: number;
  /** Sets à gagner pour remporter le match (premier à N). 1 = pas de sets. */
  sets: number;
  checkoutStrategy?: CheckoutStrategy;
  favoriteDouble?: number;
}

export interface X01State {
  remaining: number[];
  opened: boolean[];
  legsWon: number[];
  setsWon: number[];
  totalLegsWon: number[];
  leg: number;
  set: number;
  legInSet: number;
  legStarter: number;
  setStarter: number;
  visitStart: { remaining: number; opened: boolean; checkoutChance: boolean } | null;
  legWonBy: number | null;
  setWonBy: number | null;
  legVisits: number[];
}

const RULE_LABEL: Record<InOutRule, string> = { single: "Simple", double: "Double", master: "Master" };

export const x01: ModeRules<X01Config, X01State> = {
  id: "x01",

  init(config, players) {
    const n = players.length;
    return {
      playerIndex: 0,
      m: {
        remaining: Array(n).fill(config.startScore),
        opened: Array(n).fill(config.inRule === "single"),
        legsWon: Array(n).fill(0),
        setsWon: Array(n).fill(0),
        totalLegsWon: Array(n).fill(0),
        leg: 1,
        set: 1,
        legInSet: 1,
        legStarter: 0,
        setStarter: 0,
        visitStart: null,
        legWonBy: null,
        setWonBy: null,
        legVisits: Array(n).fill(0),
      },
    };
  },

  onDart(ctx, dart) {
    const m = structuredClone(ctx.m);
    const i = ctx.playerIndex;
    const { config } = ctx;
    if (ctx.visitDarts.length === 0) {
      m.visitStart = {
        remaining: m.remaining[i] as number,
        opened: m.opened[i] as boolean,
        checkoutChance: (m.opened[i] as boolean) && canCheckout(m.remaining[i] as number, config.outRule, 3),
      };
    }
    const before = m.remaining[i] as number;
    const checkoutAttempt =
      (m.opened[i] as boolean) && config.outRule !== "single" && isOneDartFinish(before, config.outRule);
    let points = 0;
    if (m.opened[i]) {
      points = dartScore(dart);
    } else if (isOpeningDart(dart, config.inRule)) {
      m.opened[i] = true;
      points = dartScore(dart);
    }
    const after = before - points;
    const result = evaluateOut(after, dart, config.outRule);
    if (result === "bust") {
      const start = m.visitStart ?? { remaining: before, opened: m.opened[i] as boolean };
      m.remaining[i] = start.remaining;
      m.opened[i] = start.opened;
      return { m, points, checkoutAttempt, endVisit: "bust" };
    }
    m.remaining[i] = after;
    if (result === "checkout") {
      m.legWonBy = i;
      (m.legsWon[i] as number)++;
      (m.totalLegsWon[i] as number)++;
      if ((m.legsWon[i] as number) >= config.legs) {
        (m.setsWon[i] as number)++;
        m.setWonBy = i;
        if ((m.setsWon[i] as number) >= config.sets) {
          return {
            m,
            points,
            checkoutAttempt,
            endVisit: "checkout",
            finished: { winners: [ctx.players[i]!.id] },
          };
        }
      }
      return { m, points, checkoutAttempt, endVisit: "checkout" };
    }
    return { m, points, checkoutAttempt };
  },

  onVisitComplete(ctx) {
    const m = structuredClone(ctx.m);
    const i = ctx.playerIndex;
    const start = m.visitStart ?? { remaining: m.remaining[i] as number, opened: true, checkoutChance: false };
    const bust = ctx.endReason === "bust";
    const checkout = m.legWonBy === i && (m.remaining[i] as number) === 0;
    const firstOfLeg = (m.legVisits[i] as number) === 0;
    (m.legVisits[i] as number)++;
    m.visitStart = null;
    return {
      m,
      record: {
        leg: m.leg,
        set: m.set,
        points: bust ? 0 : start.remaining - (m.remaining[i] as number),
        bust,
        checkout,
        remainingBefore: start.remaining,
        remainingAfter: m.remaining[i] as number,
        checkoutChance: start.checkoutChance,
        firstOfLeg,
      },
    };
  },

  advance(ctx) {
    const m = structuredClone(ctx.m);
    const n = ctx.players.length;
    if (m.legWonBy !== null) {
      const setWon = m.setWonBy !== null;
      m.remaining = Array(n).fill(ctx.config.startScore);
      m.opened = Array(n).fill(ctx.config.inRule === "single");
      m.legVisits = Array(n).fill(0);
      m.leg += 1;
      if (setWon) {
        m.set += 1;
        m.legInSet = 1;
        m.legsWon = Array(n).fill(0);
        m.setStarter = (m.setStarter + 1) % n;
        m.legStarter = m.setStarter;
      } else {
        m.legInSet += 1;
        m.legStarter = (m.legStarter + 1) % n;
      }
      m.legWonBy = null;
      m.setWonBy = null;
      return { m, playerIndex: m.legStarter, round: 1 };
    }
    const next = nextIndex(ctx.playerIndex, n);
    return { m, playerIndex: next, round: next === m.legStarter ? ctx.round + 1 : ctx.round };
  },

  legInfo(m) {
    return { leg: m.leg, set: m.set };
  },

  view(state) {
    const { config, m, players, turn } = state;
    const multiSet = config.sets > 1;
    const legVisits = state.visits.filter((v) => v.leg === m.leg);
    const view = players.map((p, i) => {
      const own = state.visits.filter((v) => v.playerId === p.id);
      const dartsThisLeg = legVisits
        .filter((v) => v.playerId === p.id)
        .reduce((sum, v) => sum + v.darts.length, 0);
      const last = own[own.length - 1];
      const details = [
        ...(multiSet ? [{ label: "Sets", value: String(m.setsWon[i]) }] : []),
        { label: "Legs", value: String(m.legsWon[i]) },
        { label: "Moy. 3 fl.", value: average3(own) },
        { label: "Fléchettes (leg)", value: String(dartsThisLeg) },
        { label: "Dernière visite", value: last ? (last.bust ? "Bust" : String(last.points)) : "–" },
      ];
      if (!m.opened[i]) details.push({ label: "Départ", value: `${RULE_LABEL[config.inRule]} requis` });
      return {
        id: p.id,
        name: p.name,
        main: String(m.remaining[i]),
        mainLabel: "Restant",
        details,
        winner: state.winners.includes(p.id),
      };
    });
    const i = turn.playerIndex;
    let checkout = null;
    if (!state.finished && !turn.complete && m.opened[i] && (m.remaining[i] as number) <= 180) {
      const dartsLeft = 3 - turn.darts.length;
      const remaining = m.remaining[i] as number;
      const routes = suggestCheckouts(remaining, {
        outRule: config.outRule,
        dartsLeft,
        strategy: config.checkoutStrategy,
        favoriteDouble: config.favoriteDouble,
        limit: 3,
      });
      checkout = { remaining, dartsLeft, routes: routes.map((r) => r.display) };
    }
    const headline = `${multiSet ? `Set ${m.set} · ` : ""}Leg ${m.legInSet} · ${config.startScore} ${RULE_LABEL[config.inRule]} départ / ${RULE_LABEL[config.outRule]} sortie`;
    return { headline, players: view, checkout };
  },
};
