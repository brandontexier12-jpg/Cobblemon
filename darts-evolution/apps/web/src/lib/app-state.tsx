import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { useSocketEvent } from "./hooks";
import type { AutodartsOverview, ModeInfo, Player } from "./types";

interface AppState {
  players: Player[];
  activePlayerId: string | null;
  activePlayer: Player | null;
  modes: ModeInfo[];
  autodarts: AutodartsOverview | null;
  auth: { adminConfigured: boolean; isAdmin: boolean };
  checkoutStrategy: "classique" | "bull" | "double_favori";
  setActivePlayer: (id: string | null) => Promise<void>;
  refreshPlayers: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  refreshAutodarts: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [activePlayerId, setActive] = useState<string | null>(null);
  const [modes, setModes] = useState<ModeInfo[]>([]);
  const [autodarts, setAutodarts] = useState<AutodartsOverview | null>(null);
  const [auth, setAuth] = useState({ adminConfigured: false, isAdmin: true });
  const [checkoutStrategy, setStrategy] = useState<AppState["checkoutStrategy"]>("classique");

  const refreshPlayers = useCallback(async () => setPlayers(await api.get<Player[]>("/api/players")), []);
  const refreshAuth = useCallback(async () => setAuth(await api.get("/api/auth/status")), []);
  const refreshAutodarts = useCallback(async () => setAutodarts(await api.get<AutodartsOverview>("/api/autodarts")), []);

  useEffect(() => {
    void refreshPlayers().catch(() => {});
    void refreshAuth().catch(() => {});
    void refreshAutodarts().catch(() => {});
    api.get<ModeInfo[]>("/api/modes").then(setModes).catch(() => {});
    api
      .get<{ general: { activePlayerId: string | null; checkoutStrategy: AppState["checkoutStrategy"] } }>("/api/settings")
      .then((s) => {
        setActive(s.general.activePlayerId);
        setStrategy(s.general.checkoutStrategy);
      })
      .catch(() => {});
  }, [refreshPlayers, refreshAuth, refreshAutodarts]);

  useSocketEvent<AutodartsOverview>("autodarts:status", setAutodarts);

  const setActivePlayer = useCallback(async (id: string | null) => {
    setActive(id);
    await api.put("/api/settings/general", { activePlayerId: id });
  }, []);

  const activePlayer = players.find((p) => p.id === activePlayerId) ?? null;
  return (
    <Ctx.Provider
      value={{ players, activePlayerId: activePlayer ? activePlayerId : null, activePlayer, modes, autodarts, auth, checkoutStrategy, setActivePlayer, refreshPlayers, refreshAuth, refreshAutodarts }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAppState(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("AppStateProvider manquant");
  return ctx;
}
