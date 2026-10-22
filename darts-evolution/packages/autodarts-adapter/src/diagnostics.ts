import type { Diagnostic, DiagnosticCode } from "@darts-evolution/shared";

export class BoardError extends Error {
  constructor(
    public readonly code: DiagnosticCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "BoardError";
  }
}

const HINTS: Record<DiagnosticCode, { message: string; hint: string }> = {
  invalid_address: {
    message: "Adresse du système Autodarts invalide.",
    hint: "Saisissez une adresse IP (ex. 192.168.1.50) ou un nom d'hôte, sans « http:// » ni chemin.",
  },
  dns: {
    message: "Nom d'hôte introuvable.",
    hint: "Vérifiez l'orthographe ou utilisez directement l'adresse IP de la machine Autodarts.",
  },
  refused: {
    message: "Connexion refusée : rien n'écoute sur ce port.",
    hint: "Le Board Manager Autodarts est-il démarré sur cette machine ? Le port est-il correct (3180 par défaut) ?",
  },
  timeout: {
    message: "Délai dépassé : la machine ne répond pas.",
    hint: "Vérifiez que la machine Autodarts est allumée, sur le même réseau, et qu'aucun pare-feu ne bloque le port.",
  },
  unreachable: {
    message: "Machine injoignable sur le réseau.",
    hint: "Le NAS et la machine Autodarts doivent être sur le même réseau local (ou routés).",
  },
  not_board_manager: {
    message: "Un service répond, mais ce n'est pas l'API locale du Board Manager Autodarts.",
    hint: "Vérifiez le port (3180 par défaut) : un autre logiciel répond peut-être à cette adresse.",
  },
  auth_required: {
    message: "Le Board Manager refuse l'accès (authentification requise).",
    hint: "L'API locale observée ne demande pas d'identifiants. Cette version semble différente : consultez docs/autodarts.md. Ne saisissez jamais vos identifiants de compte Autodarts ici.",
  },
  incompatible: {
    message: "Réponse du Board Manager dans un format non pris en charge.",
    hint: "Cette version d'Autodarts n'a pas été vérifiée. Utilisez la saisie manuelle et consultez docs/autodarts.md.",
  },
  detection_stopped: {
    message: "Connecté, mais la détection est arrêtée sur le Board Manager.",
    hint: "Démarrez la détection dans Autodarts (ou depuis la page Intégration).",
  },
  no_throw_data: {
    message: "Le Board Manager signale des fléchettes sans en transmettre le détail.",
    hint: "Comportement signalé sur certaines installations Autodarts 2.x : les impacts ne peuvent pas être lus localement. Utilisez la saisie manuelle.",
  },
  unknown: {
    message: "Erreur inattendue de communication avec Autodarts.",
    hint: "Consultez les journaux du conteneur pour plus de détails.",
  },
};

export function makeDiagnostic(code: DiagnosticCode, detail?: string): Diagnostic {
  const base = HINTS[code];
  return {
    code,
    message: detail ? `${base.message} (${detail})` : base.message,
    hint: base.hint,
    at: new Date().toISOString(),
  };
}

/** Classe une erreur réseau Node.js en diagnostic exploitable. */
export function classifyError(error: unknown): Diagnostic {
  if (error instanceof BoardError) return makeDiagnostic(error.code, error.status ? `HTTP ${error.status}` : undefined);
  const err = error as { code?: string; name?: string; cause?: { code?: string; name?: string } };
  const code = err?.cause?.code ?? err?.code;
  const name = err?.cause?.name ?? err?.name;
  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return makeDiagnostic("dns");
    case "ECONNREFUSED":
      return makeDiagnostic("refused");
    case "ETIMEDOUT":
    case "UND_ERR_CONNECT_TIMEOUT":
    case "UND_ERR_HEADERS_TIMEOUT":
      return makeDiagnostic("timeout");
    case "EHOSTUNREACH":
    case "ENETUNREACH":
    case "EHOSTDOWN":
      return makeDiagnostic("unreachable");
    case "ECONNRESET":
    case "EPIPE":
      return makeDiagnostic("unknown", "connexion interrompue");
  }
  if (name === "TimeoutError" || name === "AbortError") return makeDiagnostic("timeout");
  return makeDiagnostic("unknown");
}

const HOSTNAME = /^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(?:\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*$/;
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9A-Fa-f:]{2,39}$/;

/** Valide un hôte saisi par l'utilisateur (IP ou nom, sans schéma ni chemin). */
export function validateHost(host: string): boolean {
  const h = host.trim();
  if (!h || h.length > 253) return false;
  if (IPV4.test(h)) return true;
  if (h.includes(":")) return IPV6.test(h.replace(/^\[|\]$/g, ""));
  return HOSTNAME.test(h);
}

export function validatePort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}
