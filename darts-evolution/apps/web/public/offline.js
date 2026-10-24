// Page « serveur injoignable » : recharge dès que le serveur répond de nouveau.
document.getElementById("retry").addEventListener("click", () => location.reload());
setInterval(() => {
  fetch("/api/health", { cache: "no-store" })
    .then((r) => r.ok && location.reload())
    .catch(() => {});
}, 10000);
