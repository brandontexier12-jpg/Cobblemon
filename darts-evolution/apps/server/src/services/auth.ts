import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { tooMany, unauthorized } from "../errors.js";

/**
 * Authentification administrateur (mot de passe unique défini par ADMIN_PASSWORD).
 * Les jetons de session vivent en mémoire : un redémarrage du conteneur déconnecte les administrateurs.
 */
export class AuthService {
  private readonly sessions = new Map<string, number>();
  private readonly failures = new Map<string, { count: number; until: number }>();
  private readonly salt = randomBytes(16);
  private readonly hash: Buffer | null;

  constructor(
    password: string | null,
    private readonly sessionHours: number,
  ) {
    // Le mot de passe n'est conservé que sous forme dérivée.
    this.hash = password ? scryptSync(password, this.salt, 32) : null;
  }

  get enabled(): boolean {
    return this.hash !== null;
  }

  login(password: string, clientKey: string): { token: string; expiresAt: string } {
    if (!this.hash) throw unauthorized("Aucun mot de passe administrateur n'est configuré (variable ADMIN_PASSWORD).");
    const now = Date.now();
    const f = this.failures.get(clientKey);
    if (f && f.until > now && f.count >= 5) throw tooMany("Trop de tentatives. Réessayez dans une minute.");
    const candidate = scryptSync(password, this.salt, 32);
    if (!timingSafeEqual(candidate, this.hash)) {
      const entry = f && f.until > now ? f : { count: 0, until: now + 60_000 };
      entry.count++;
      this.failures.set(clientKey, entry);
      throw unauthorized("Mot de passe incorrect.");
    }
    this.failures.delete(clientKey);
    const token = randomBytes(32).toString("hex");
    const expires = now + this.sessionHours * 3600_000;
    this.sessions.set(token, expires);
    return { token, expiresAt: new Date(expires).toISOString() };
  }

  logout(token: string | undefined): void {
    if (token) this.sessions.delete(token);
  }

  /** Sans mot de passe configuré, les actions d'administration restent ouvertes (avec avertissement). */
  isAdmin(token: string | undefined): boolean {
    if (!this.hash) return true;
    if (!token) return false;
    const expires = this.sessions.get(token);
    if (!expires) return false;
    if (expires < Date.now()) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }
}
