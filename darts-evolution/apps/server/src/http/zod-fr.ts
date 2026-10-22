import { z, ZodIssueCode, type ZodErrorMap } from "zod";

/** Messages de validation en français (les messages explicites des schémas restent prioritaires). */
export const frenchErrorMap: ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === "undefined") return { message: "Valeur obligatoire." };
      return { message: `Type invalide : ${issue.expected} attendu.` };
    case ZodIssueCode.too_small:
      if (issue.type === "string") return { message: `Au moins ${issue.minimum} caractère(s).` };
      if (issue.type === "array") return { message: `Au moins ${issue.minimum} élément(s).` };
      return { message: `Valeur trop petite (minimum ${issue.minimum}).` };
    case ZodIssueCode.too_big:
      if (issue.type === "string") return { message: `Au plus ${issue.maximum} caractère(s).` };
      if (issue.type === "array") return { message: `Au plus ${issue.maximum} élément(s).` };
      return { message: `Valeur trop grande (maximum ${issue.maximum}).` };
    case ZodIssueCode.invalid_enum_value:
      return { message: `Valeur non autorisée (choix possibles : ${issue.options.join(", ")}).` };
    case ZodIssueCode.invalid_string:
      return { message: "Format invalide." };
    case ZodIssueCode.unrecognized_keys:
      return { message: "Champ(s) inconnu(s)." };
    default:
      return { message: ctx.defaultError };
  }
};

export function installFrenchErrors(): void {
  z.setErrorMap(frenchErrorMap);
}
