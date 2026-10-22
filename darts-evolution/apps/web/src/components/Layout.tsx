import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAppState } from "../lib/app-state";
import { useServerConnection, useServerUpdated } from "../lib/hooks";
import { AutodartsPill } from "./AutodartsStatus";
import { Icon } from "./Icon";
import { Logo } from "./Logo";
import { PlayerAvatar } from "./ui";

export const NAV = [
  { to: "/", label: "Accueil", icon: "home" },
  { to: "/jouer", label: "Jouer", icon: "play" },
  { to: "/carriere", label: "Carrière", icon: "star" },
  { to: "/entrainement", label: "Entraînement", icon: "training" },
  { to: "/statistiques", label: "Statistiques", icon: "chart" },
  { to: "/joueurs", label: "Joueurs", icon: "users" },
  { to: "/competitions", label: "Compétitions", icon: "trophy" },
  { to: "/historique", label: "Historique", icon: "history" },
  { to: "/autodarts", label: "Intégration Autodarts", icon: "plug" },
  { to: "/parametres", label: "Paramètres", icon: "settings" },
];

// Barre du bas sur téléphone : les destinations les plus utilisées.
const MOBILE = ["/", "/jouer", "/entrainement", "/statistiques", "/plus"];

export function Layout() {
  const { activePlayer, autodarts } = useAppState();
  const online = useServerConnection();
  const updatedTo = useServerUpdated();
  const location = useLocation();
  // Pendant une partie : plein écran, sans menu (bouton « Menu » dans l'en-tête de la partie).
  const focus = location.pathname.startsWith("/partie/");
  return (
    <div className="min-h-screen lg:flex">
      <aside className={`sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-ink-800 bg-ink-900 p-4 ${focus ? "" : "lg:flex"}`}>
        <NavLink to="/" className="mb-6 px-2">
          <Logo />
        </NavLink>
        <nav className="flex flex-1 flex-col gap-1" aria-label="Navigation principale">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `press flex min-h-11 items-center gap-3 rounded-xl px-3 text-[0.95rem] ${isActive ? "bg-brand-500/15 font-semibold text-brand-300" : "text-ink-200 hover:bg-ink-800"}`
              }
            >
              <Icon name={item.icon} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-3 border-t border-ink-800 pt-4">
          <AutodartsPill overview={autodarts} compact />
          {activePlayer && (
            <NavLink to={`/joueurs/${activePlayer.id}`} className="flex items-center gap-2 rounded-xl px-2 py-1 hover:bg-ink-800">
              <PlayerAvatar avatar={activePlayer.avatar} color={activePlayer.color} size={32} />
              <span className="truncate text-sm text-ink-200">{activePlayer.name}</span>
            </NavLink>
          )}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className={`sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-ink-800 bg-ink-950/90 px-4 py-2.5 backdrop-blur lg:hidden ${focus ? "hidden" : ""}`}>
          <NavLink to="/">
            <Logo compact />
          </NavLink>
          <AutodartsPill overview={autodarts} compact />
        </header>
        {!online && (
          <div className="flex items-center gap-2 bg-critical/20 px-4 py-2 text-sm text-[#ffb4b4]" role="alert">
            <Icon name="warning" size={16} /> Connexion temps réel au serveur perdue — reconnexion automatique en cours.
          </div>
        )}
        {updatedTo && (
          <div className="flex flex-wrap items-center gap-2 bg-brand-500/15 px-4 py-2 text-sm text-brand-300" role="status">
            <Icon name="info" size={16} /> DARTS EVOLUTION a été mis à jour (version {updatedTo}).
            <button className="font-semibold underline underline-offset-2" onClick={() => window.location.reload()}>
              Recharger la page
            </button>
          </div>
        )}
        <main
          key={location.pathname}
          className={`animate-pop mx-auto w-full ${focus ? "max-w-[1760px] px-3 pb-6 pt-3 sm:px-5" : "max-w-7xl px-4 pb-28 pt-5 sm:px-6 lg:pb-10"}`}
        >
          <Outlet />
        </main>
      </div>

      <nav
        className={`fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-ink-800 bg-ink-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden ${focus ? "!hidden" : ""}`}
        aria-label="Navigation"
      >
        {MOBILE.map((to) => {
          const item = to === "/plus" ? { to, label: "Plus", icon: "menu" } : NAV.find((n) => n.to === to)!;
          return (
            <NavLink
              key={to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) => `press flex min-h-16 flex-col items-center justify-center gap-1 text-[0.7rem] ${isActive ? "text-brand-400" : "text-ink-300"}`}
            >
              <Icon name={item.icon} size={22} />
              {item.label === "Intégration Autodarts" ? "Autodarts" : item.label}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}

/** Page « Plus » sur téléphone : accès à toutes les sections. */
export function MorePage() {
  return (
    <div>
      <h1 className="font-display mb-4 text-3xl font-bold uppercase">Menu</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} className="press flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-ink-700 bg-ink-850 p-4 text-center hover:border-ink-500">
            <Icon name={item.icon} size={26} className="text-brand-500" />
            <span className="text-sm text-ink-100">{item.label}</span>
          </NavLink>
        ))}
        <NavLink to="/salle" className="press flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-ink-700 bg-ink-850 p-4 text-center hover:border-ink-500">
          <Icon name="link" size={26} className="text-brand-500" />
          <span className="text-sm text-ink-100">Rejoindre une salle</span>
        </NavLink>
      </div>
    </div>
  );
}
