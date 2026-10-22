import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { ZodError, z } from "zod";
import type { AppContext } from "../context.js";
import { AppError } from "../errors.js";
import type { AutodartsNotice } from "../services/autodarts.js";
import { CommandInput, type MatchSnapshot } from "../services/matches.js";

interface Presence {
  socketId: string;
  name: string;
  role: "player" | "spectator";
  joinedAt: string;
}

const JoinInput = z.object({
  matchId: z.string().uuid().optional(),
  code: z.string().trim().min(4).max(8).optional(),
  role: z.enum(["player", "spectator"]).default("player"),
  name: z.string().trim().max(32).default("Appareil"),
});

type Ack = (response: unknown) => void;

function errorMessage(error: unknown): { ok: false; error: string; message: string } {
  if (error instanceof AppError) return { ok: false, error: error.code, message: error.message };
  if (error instanceof ZodError) return { ok: false, error: "validation", message: error.issues[0]?.message ?? "Requête invalide." };
  return { ok: false, error: "internal", message: "Erreur interne du serveur." };
}

/**
 * Multijoueur local : plusieurs appareils du réseau rejoignent une partie par son code de salle.
 * Le serveur reste l'unique autorité sur le score ; les commandes répétées (même identifiant)
 * ne sont appliquées qu'une fois et une commande basée sur une version périmée est refusée.
 */
export function attachRealtime(server: HttpServer, ctx: AppContext): Server {
  const io = new Server(server, { path: "/socket.io", serveClient: false, maxHttpBufferSize: 64 * 1024 });
  const presence = new Map<string, Map<string, Presence>>();

  const roomOf = (matchId: string) => `match:${matchId}`;
  const publishPresence = (matchId: string) => {
    io.to(roomOf(matchId)).emit("room:presence", { matchId, devices: [...(presence.get(matchId)?.values() ?? [])] });
  };
  const leave = (socket: Socket, matchId: string) => {
    socket.leave(roomOf(matchId));
    const room = presence.get(matchId);
    if (room?.delete(socket.id)) {
      if (room.size === 0) presence.delete(matchId);
      publishPresence(matchId);
    }
  };

  ctx.matches.on("updated", (snapshot: MatchSnapshot) => io.to(roomOf(snapshot.match.id)).emit("match:state", snapshot));
  ctx.matches.on("deleted", (matchId: string) => io.to(roomOf(matchId)).emit("match:deleted", { matchId }));
  ctx.autodarts.on("status", (overview) => io.emit("autodarts:status", overview));
  ctx.autodarts.on("notice", (notice: AutodartsNotice) => {
    if (notice.matchId) io.to(roomOf(notice.matchId)).emit("autodarts:notice", notice);
    io.to("autodarts").emit("autodarts:notice", notice);
  });
  ctx.autodarts.on("journal", () => io.to("autodarts").emit("autodarts:journal"));

  io.on("connection", (socket) => {
    const joined = new Map<string, Presence["role"]>();

    socket.on("room:join", (raw: unknown, ack?: Ack) => {
      try {
        const input = JoinInput.parse(raw ?? {});
        const snapshot = input.matchId ? ctx.matches.get(input.matchId) : input.code ? ctx.matches.getByRoomCode(input.code) : null;
        if (!snapshot) throw new AppError(400, "bad_request", "Indiquez une partie ou un code de salle.");
        const matchId = snapshot.match.id;
        socket.join(roomOf(matchId));
        joined.set(matchId, input.role);
        const room = presence.get(matchId) ?? new Map<string, Presence>();
        room.set(socket.id, { socketId: socket.id, name: input.name || "Appareil", role: input.role, joinedAt: new Date().toISOString() });
        presence.set(matchId, room);
        publishPresence(matchId);
        ack?.({ ok: true, snapshot, devices: [...room.values()] });
      } catch (error) {
        ack?.(errorMessage(error));
      }
    });

    socket.on("room:leave", (raw: unknown) => {
      const parsed = z.object({ matchId: z.string().uuid() }).safeParse(raw);
      if (parsed.success) {
        joined.delete(parsed.data.matchId);
        leave(socket, parsed.data.matchId);
      }
    });

    socket.on("match:command", (raw: unknown, ack?: Ack) => {
      try {
        const { matchId, command } = z.object({ matchId: z.string().uuid(), command: CommandInput }).parse(raw);
        const role = joined.get(matchId);
        if (!role) throw new AppError(403, "forbidden", "Rejoignez d'abord la salle.");
        if (role === "spectator") throw new AppError(403, "forbidden", "Un spectateur ne peut pas modifier le score.");
        ack?.({ ok: true, ...ctx.matches.command(matchId, { ...command, source: "manual" }) });
      } catch (error) {
        ack?.(errorMessage(error));
      }
    });

    socket.on("autodarts:watch", () => {
      socket.join("autodarts");
      socket.emit("autodarts:status", ctx.autodarts.overview());
    });

    socket.on("disconnect", () => {
      for (const matchId of joined.keys()) leave(socket, matchId);
    });
  });

  return io;
}
