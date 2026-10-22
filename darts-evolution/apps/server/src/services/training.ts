import { randomUUID } from "node:crypto";
import { OPTION_SCHEMAS } from "@darts-evolution/game-engine";
import { GOAL_METRICS, goalProgress, weekStart, type GoalMetric } from "@darts-evolution/statistics";
import { z } from "zod";
import { nowIso, parseJson, type Database } from "../db/database.js";
import { notFound } from "../errors.js";
import type { PlayerService } from "./players.js";
import type { StatsService } from "./stats.js";

export const ExerciseInput = z.object({
  name: z.string().trim().min(1, "Le nom est obligatoire.").max(60),
  options: OPTION_SCHEMAS.custom_training.omit({ name: true }),
});

export const GoalInput = z.object({
  playerId: z.string().uuid(),
  metric: z.enum(GOAL_METRICS.map((m) => m.id) as [GoalMetric, ...GoalMetric[]]),
  target: z.number().positive().max(1_000_000),
});

/** Exercices personnalisés enregistrés et objectifs hebdomadaires. */
export class TrainingService {
  constructor(
    private readonly db: Database,
    private readonly players: PlayerService,
    private readonly stats: StatsService,
  ) {}

  exercises() {
    return this.db
      .all<{ id: string; name: string; options: string; created_at: string }>("SELECT * FROM exercises WHERE archived_at IS NULL ORDER BY name")
      .map((r) => ({ id: r.id, name: r.name, options: parseJson(r.options, {}), createdAt: r.created_at }));
  }

  createExercise(input: unknown) {
    const data = ExerciseInput.parse(input);
    const id = randomUUID();
    this.db.run("INSERT INTO exercises (id, name, options, created_at) VALUES ($id, $name, $opt, $at)", {
      $id: id,
      $name: data.name,
      $opt: JSON.stringify({ ...data.options, name: data.name }),
      $at: nowIso(),
    });
    return this.exercises().find((e) => e.id === id)!;
  }

  deleteExercise(id: string) {
    const r = this.db.run("UPDATE exercises SET archived_at = $at WHERE id = $id AND archived_at IS NULL", { $id: id, $at: nowIso() });
    if (r.changes === 0) throw notFound("Exercice");
  }

  /** Objectifs du joueur avec leur progression sur la semaine en cours (lundi → dimanche). */
  goals(playerId: string, now = new Date()) {
    this.players.get(playerId);
    const monday = new Date(`${weekStart(now.toISOString())}T00:00:00`);
    const from = monday.toISOString();
    const to = new Date(monday.getTime() + 7 * 86400_000 - 1).toISOString();
    const visits = this.stats.visits({ playerId, from, to });
    const matches = this.stats.matches({ playerId, from, to });
    return {
      weekStart: from,
      weekEnd: to,
      goals: this.db
        .all<{ id: string; metric: GoalMetric; target: number; created_at: string }>(
          "SELECT * FROM weekly_goals WHERE player_id = $p AND archived_at IS NULL ORDER BY created_at",
          { $p: playerId },
        )
        .map((g) => ({
          id: g.id,
          label: GOAL_METRICS.find((m) => m.id === g.metric)?.label ?? g.metric,
          unit: GOAL_METRICS.find((m) => m.id === g.metric)?.unit ?? "",
          ...goalProgress(g.metric, g.target, visits, matches),
        })),
    };
  }

  createGoal(input: unknown) {
    const data = GoalInput.parse(input);
    this.players.get(data.playerId);
    const id = randomUUID();
    this.db.run("INSERT INTO weekly_goals (id, player_id, metric, target, created_at) VALUES ($id, $p, $m, $t, $at)", {
      $id: id,
      $p: data.playerId,
      $m: data.metric,
      $t: data.target,
      $at: nowIso(),
    });
    return this.goals(data.playerId);
  }

  deleteGoal(id: string) {
    const r = this.db.run("UPDATE weekly_goals SET archived_at = $at WHERE id = $id AND archived_at IS NULL", { $id: id, $at: nowIso() });
    if (r.changes === 0) throw notFound("Objectif");
  }
}
