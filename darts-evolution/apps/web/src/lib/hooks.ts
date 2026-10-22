import { useCallback, useEffect, useRef, useState } from "react";
import { getSocket } from "./socket";

export interface AsyncState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
  setData: (value: T) => void;
}

/** Chargement asynchrone avec rechargement manuel. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fnRef
      .current()
      .then((value) => {
        if (!cancelled) {
          setData(value);
          setError(null);
        }
      })
      .catch((err: Error) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}

/** Abonnement à un événement Socket.IO pendant la vie du composant. */
export function useSocketEvent<T>(event: string, handler: (payload: T) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const socket = getSocket();
    const listener = (payload: T) => ref.current(payload);
    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
    };
  }, [event]);
}

/** État de la connexion temps réel au serveur. */
export function useServerConnection(): boolean {
  const [connected, setConnected] = useState(() => getSocket().connected);
  useEffect(() => {
    const socket = getSocket();
    const on = () => setConnected(true);
    const off = () => setConnected(false);
    socket.on("connect", on);
    socket.on("disconnect", off);
    return () => {
      socket.off("connect", on);
      socket.off("disconnect", off);
    };
  }, []);
  return connected;
}

/** Préférence locale par appareil (stockage navigateur protégé : jamais bloquant). */
export function useLocalPreference<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`de:${key}`);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(`de:${key}`, JSON.stringify(next));
      } catch {
        /* stockage indisponible : préférence non mémorisée */
      }
    },
    [key],
  );
  return [value, update];
}

/**
 * Version du serveur : détecte une mise à jour installée pendant que la page est ouverte
 * (vérifiée à chaque reconnexion temps réel). Renvoie la nouvelle version, sinon null.
 */
export function useServerUpdated(): string | null {
  const [updated, setUpdated] = useState<string | null>(null);
  useEffect(() => {
    let initial: string | null = null;
    const check = () => {
      fetch("/api/health", { credentials: "same-origin" })
        .then((r) => r.json() as Promise<{ version?: string }>)
        .then((h) => {
          if (!h.version) return;
          if (initial === null) initial = h.version;
          else if (h.version !== initial) setUpdated(h.version);
        })
        .catch(() => {});
    };
    check();
    const socket = getSocket();
    socket.on("connect", check);
    return () => {
      socket.off("connect", check);
    };
  }, []);
  return updated;
}
