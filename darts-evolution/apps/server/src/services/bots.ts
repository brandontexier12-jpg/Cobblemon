import { botThrow, peekNextPlayerIndex, type GameState } from "@darts-evolution/game-engine";
import type { AdapterLogger } from "@darts-evolution/autodarts-adapter";
import { AppError } from "../errors.js";
import type { MatchService, MatchSnapshot } from "./matches.js";

export interface BotTiming {
  /** Avant la première fléchette d'une visite. */
  firstDartMs: number;
  /** Entre deux fléchettes. */
  dartMs: number;
  /** Après la visite du bot, avant de passer au joueur suivant. */
  nextMs: number;
  /** Saisie manuelle : après la visite d'un humain, avant que le bot prenne la main. */
  handOverMs: number;
  /** Pause des bots après une annulation (laisse le temps d'annuler plusieurs fléchettes). */
  undoPauseMs: number;
  /** Killer : durée de la roue du tirage par joueur à l'écran (2,6 s de rotation + 0,9 s de pause). */
  killerDrawMs: number;
}

export const DEFAULT_BOT_TIMING: BotTiming = { firstDartMs: 1300, dartMs: 1000, nextMs: 1800, handOverMs: 2500, undoPauseMs: 6000, killerDrawMs: 3500 };

/**
 * Fait jouer les bots : à chaque changement d'une partie, si c'est le tour d'un bot, sa prochaine
 * action est programmée (fléchette, puis passage au joueur suivant). Le bot passe par la même
 * commande que les autres appareils (serveur = autorité du score) : chaque action porte la version
 * de la partie qu'il a vue, une action d'un humain entre-temps l'annule simplement.
 */
export class BotService {
  private timers = new Map<string, NodeJS.Timeout>();
  private pausedUntil = new Map<string, number>();
  private stopped = true;
  private readonly onUpdated = (snapshot: MatchSnapshot, kind?: string) => {
    if (kind === "undo") this.pausedUntil.set(snapshot.match.id, Date.now() + this.timing.undoPauseMs);
    this.schedule(snapshot.match.id);
  };
  private readonly onDeleted = (matchId: string) => this.clear(matchId);

  constructor(
    private readonly matches: MatchService,
    private readonly log: AdapterLogger,
    private readonly timing: BotTiming = DEFAULT_BOT_TIMING,
    private readonly rng: () => number = Math.random,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.matches.on("updated", this.onUpdated);
    this.matches.on("deleted", this.onDeleted);
    // Parties en cours au démarrage (redémarrage du serveur pendant le tour d'un bot).
    for (const item of this.matches.list({ status: "active", includeSimulation: true, limit: 200 }).items) this.schedule(item.id);
  }

  stop(): void {
    this.stopped = true;
    this.matches.off("updated", this.onUpdated);
    this.matches.off("deleted", this.onDeleted);
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  private clear(matchId: string): void {
    const t = this.timers.get(matchId);
    if (t) clearTimeout(t);
    this.timers.delete(matchId);
  }

  /** Programme la prochaine action d'un bot dans cette partie (ou rien). */
  schedule(matchId: string): void {
    this.clear(matchId);
    if (this.stopped) return;
    let plan: { delay: number; run: () => void } | null;
    try {
      plan = this.plan(matchId);
    } catch {
      return; // partie supprimée entre-temps
    }
    if (!plan) return;
    const pause = Math.max(0, (this.pausedUntil.get(matchId) ?? 0) - Date.now());
    const timer = setTimeout(() => {
      this.timers.delete(matchId);
      if (this.stopped) return;
      try {
        plan!.run();
      } catch (error) {
        // Conflit de version (un humain a joué entre-temps) : la mise à jour reprogramme le bot.
        if (!(error instanceof AppError)) this.log.error("Action de bot impossible.", { matchId, error: (error as Error).message });
      }
    }, plan.delay + pause);
    timer.unref?.();
    this.timers.set(matchId, timer);
  }

  private plan(matchId: string): { delay: number; run: () => void } | null {
    const snapshot = this.matches.get(matchId);
    if (snapshot.match.status !== "active") return null;
    const state = this.matches.getState(matchId) as GameState;
    if (state.finished) return null;
    const version = snapshot.match.version;
    const players = snapshot.match.players;
    const current = players[state.turn.playerIndex];

    if (current?.botAverage != null) {
      const average = current.botAverage;
      if (!state.turn.complete) {
        // Killer : laisse la roue du tirage des numéros se terminer à l'écran avant la première fléchette.
        const draw = state.mode === "killer" && version === 0 && this.timing.killerDrawMs > 0 ? players.length * this.timing.killerDrawMs + 1600 : 0;
        return {
          delay: (state.turn.darts.length === 0 ? this.timing.firstDartMs : this.timing.dartMs) + draw,
          run: () => {
            const fresh = this.matches.getState(matchId) as GameState;
            const { dart, coords } = botThrow(fresh, average, this.rng);
            this.matches.command(matchId, { kind: "dart", dart, coords, source: "bot", baseVersion: version, commandId: `bot:${matchId}:${version}` });
          },
        };
      }
      // Visite du bot terminée : il passe la main lui-même (ses fléchettes sont virtuelles).
      return { delay: this.timing.nextMs, run: () => void this.matches.command(matchId, { kind: "next", source: "bot", baseVersion: version, commandId: `bot:${matchId}:${version}` }) };
    }

    // Visite d'un humain terminée, au tour d'un bot ensuite : en saisie manuelle, la main passe seule.
    // Avec Autodarts, c'est le retrait des fléchettes qui passe la main (comme entre humains).
    if (state.turn.complete && snapshot.match.inputMode === "manual") {
      const next = peekNextPlayerIndex(state);
      if (next !== null && players[next]?.botAverage != null) {
        return { delay: this.timing.handOverMs, run: () => void this.matches.command(matchId, { kind: "next", baseVersion: version, commandId: `bot-main:${matchId}:${version}` }) };
      }
    }
    return null;
  }
}
