// Contrôle de santé Docker : l'API répond et la base SQLite est accessible.
const port = process.env.APP_PORT || "8080";
try {
  const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(4000) });
  const body = await res.json();
  process.exit(res.ok && body.status === "ok" ? 0 : 1);
} catch {
  process.exit(1);
}
