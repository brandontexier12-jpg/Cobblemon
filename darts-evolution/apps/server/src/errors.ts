export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what: string) => new AppError(404, "not_found", `${what} introuvable.`);
export const badRequest = (message: string) => new AppError(400, "bad_request", message);
export const conflict = (message: string, code = "conflict") => new AppError(409, code, message);
export const unauthorized = (message = "Authentification administrateur requise.") => new AppError(401, "unauthorized", message);
export const tooMany = (message: string) => new AppError(429, "too_many_requests", message);
