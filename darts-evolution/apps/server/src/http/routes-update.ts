import type { FastifyInstance } from "fastify";
import { requireAdmin, type AppContext } from "../context.js";
import { badRequest } from "../errors.js";
import { MAX_PACKAGE_BYTES } from "../services/updates.js";

/** Mise à jour de l'application depuis l'interface (paquet .zip). */
export function registerUpdateRoutes(app: FastifyInstance, ctx: AppContext): void {
  const admin = requireAdmin(ctx);

  // Lecture seule et sans secret : consultable après le redémarrage, même déconnecté.
  app.get("/api/update", async () => ctx.updates.status());

  app.post("/api/update", { preHandler: admin, bodyLimit: MAX_PACKAGE_BYTES }, async (req) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 22) throw badRequest("Envoyez le fichier de mise à jour (.zip) en application/octet-stream.");
    const result = ctx.updates.install(req.body);
    req.log.info({ version: result.version, from: result.from, backup: result.backup }, "Mise à jour installée : redémarrage.");
    return result;
  });

  app.post("/api/update/revert", { preHandler: admin }, async (req) => {
    const result = ctx.updates.revert();
    req.log.info({ version: result.version }, "Retour à la version précédente : redémarrage.");
    return result;
  });
}
