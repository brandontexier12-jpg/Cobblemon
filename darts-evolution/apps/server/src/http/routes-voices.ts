import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, type AppContext } from "../context.js";
import { AppError, badRequest } from "../errors.js";
import { MAX_VOICE_PACK_BYTES } from "../services/voices.js";

/** Packs de voix de l'annonceur. */
export function registerVoiceRoutes(app: FastifyInstance, ctx: AppContext): void {
  const admin = requireAdmin(ctx);
  const idParam = z.object({ id: z.string().max(60) });

  app.get("/api/voices", async () => ctx.voices.list());

  app.post("/api/voices", { preHandler: admin, bodyLimit: MAX_VOICE_PACK_BYTES }, async (req, reply) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 22) throw badRequest("Envoyez le pack de voix (.zip) en application/octet-stream.");
    if (req.body.length > MAX_VOICE_PACK_BYTES) throw new AppError(413, "too_large", "Pack trop volumineux.");
    const { name } = z.object({ name: z.string().max(120).default("Pack de voix") }).parse(req.query);
    const result = ctx.voices.import(req.body, name);
    req.log.info({ pack: result.pack.id, files: Object.keys(result.pack.files).length, skipped: result.skipped.length }, "Pack de voix importé.");
    return reply.code(201).send(result);
  });

  app.put("/api/voices/:id/roles", { preHandler: admin }, async (req) => ctx.voices.setRoles(idParam.parse(req.params).id, req.body));

  app.delete("/api/voices/:id", { preHandler: admin }, async (req, reply) => {
    ctx.voices.delete(idParam.parse(req.params).id);
    return reply.code(204).send();
  });

  // Les fichiers d'un pack ne changent jamais (un nouvel import crée un nouveau pack) : cache longue durée.
  app.get("/api/voices/:id/files/:key", async (req, reply) => {
    const { id, key } = z.object({ id: z.string().max(60), key: z.string().max(40) }).parse(req.params);
    const file = ctx.voices.file(id, key);
    return reply.header("content-type", file.type).header("cache-control", "public, max-age=31536000, immutable").send(createReadStream(file.path));
  });
}
