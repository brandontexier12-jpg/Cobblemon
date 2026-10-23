import { useState } from "react";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { useAppState } from "../lib/app-state";
import type { Player } from "../lib/types";
import { Icon } from "./Icon";
import { Button, inputClass, PlayerAvatar, useUi } from "./ui";

/** Sélection rapide et ordonnée des joueurs (l'ordre de sélection est l'ordre de jeu). */
export function PlayerPicker({ selected, onChange, max = 8 }: { selected: string[]; onChange: (ids: string[]) => void; max?: number }) {
  const { players, refreshPlayers } = useAppState();
  const { toast } = useUi();
  const [guests, setGuests] = useState<Player[]>([]);
  const [newName, setNewName] = useState("");
  const botLevels = useAsync(() => api.get<{ average: number; label: string; name: string }[]>("/api/bots"), []);
  const [botAverage, setBotAverage] = useState(60);
  const all = [...players, ...guests];
  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((s) => s !== id));
    else if (selected.length < max) onChange([...selected, id]);
    else toast(`${max} joueurs maximum pour ce mode.`, "warning");
  };
  const move = (index: number, delta: number) => {
    const next = [...selected];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };
  const shuffleOrder = () => {
    const next = [...selected];
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j]!, next[i]!];
    }
    onChange(next);
  };
  const addGuest = async () => {
    try {
      // Numéro libre : les invités déjà choisis pour cette partie gardent le leur.
      const taken = all.filter((p) => p.isGuest && selected.includes(p.id)).map((p) => p.name);
      const guest = await api.post<Player>("/api/players/guest", { name: newName || undefined, taken });
      setGuests((g) => [...g, guest]);
      setNewName("");
      if (selected.length < max) onChange([...selected, guest.id]);
    } catch (e) {
      toast((e as Error).message, "critical");
    }
  };
  const addBot = async () => {
    try {
      const bot = await api.post<Player>(`/api/bots/${botAverage}`);
      setGuests((g) => (g.some((x) => x.id === bot.id) ? g : [...g, bot]));
      if (!selected.includes(bot.id) && selected.length < max) onChange([...selected, bot.id]);
    } catch (e) {
      toast((e as Error).message, "critical");
    }
  };
  const addPlayer = async () => {
    if (!newName.trim()) return;
    try {
      const player = await api.post<Player>("/api/players", { name: newName.trim() });
      await refreshPlayers();
      setNewName("");
      if (selected.length < max) onChange([...selected, player.id]);
    } catch (e) {
      toast((e as Error).message, "critical");
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {all.map((p) => {
          const index = selected.indexOf(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => toggle(p.id)}
              aria-pressed={index >= 0}
              className={`press flex min-h-12 items-center gap-2 rounded-full border py-1 pl-1 pr-3 ${index >= 0 ? "border-brand-500 bg-brand-500/15" : "border-ink-600 bg-ink-900 hover:border-ink-500"}`}
            >
              <PlayerAvatar avatar={p.avatar} color={p.color} photo={p.photo} size={36} />
              <span className="text-ink-100">{p.name}</span>
              {index >= 0 && <span className="font-display rounded-full bg-brand-500 px-2 text-sm font-bold text-ink-950">{index + 1}</span>}
            </button>
          );
        })}
        {all.length === 0 && <p className="text-ink-400">Aucun joueur : créez-en un ou ajoutez un invité ci-dessous.</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <input className={`${inputClass} min-w-40 max-w-xs flex-1`} placeholder="Nouveau joueur ou invité…" value={newName} maxLength={32} onChange={(e) => setNewName(e.target.value)} />
        <Button icon="plus" onClick={addPlayer} disabled={!newName.trim()}>
          Créer le profil
        </Button>
        <Button variant="ghost" icon="users" onClick={addGuest}>
          Invité
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-700 bg-ink-900 p-2">
        <Icon name="bot" className="ml-1 text-brand-400" />
        <label className="text-sm text-ink-300" htmlFor="bot-level">
          Adversaire bot
        </label>
        <select id="bot-level" className={`${inputClass} w-auto min-w-48 flex-1 sm:flex-none`} value={botAverage} onChange={(e) => setBotAverage(Number(e.target.value))}>
          {(botLevels.data ?? []).map((l) => (
            <option key={l.average} value={l.average}>
              {l.name} — {l.label} (moyenne {l.average === 170 ? "≈ 167, le maximum" : l.average})
            </option>
          ))}
        </select>
        <Button icon="plus" onClick={addBot} disabled={!botLevels.data}>
          Ajouter le bot
        </Button>
      </div>
      {selected.length > 1 && (
        <div className="rounded-xl border border-ink-700 bg-ink-900 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-ink-200">Ordre de jeu</span>
            <Button size="sm" variant="ghost" icon="shuffle" onClick={shuffleOrder}>
              Ordre aléatoire
            </Button>
          </div>
          <ol className="space-y-1">
            {selected.map((id, i) => {
              const p = all.find((x) => x.id === id);
              return (
                <li key={id} className="flex items-center gap-2">
                  <span className="font-display w-6 text-lg font-bold text-brand-400">{i + 1}</span>
                  <span className="flex-1 truncate">{p?.name ?? "?"}</span>
                  <button type="button" className="press rounded-lg p-2 text-ink-300 hover:bg-ink-700" onClick={() => move(i, -1)} aria-label="Monter">
                    <Icon name="up" size={16} />
                  </button>
                  <button type="button" className="press rounded-lg p-2 text-ink-300 hover:bg-ink-700" onClick={() => move(i, 1)} aria-label="Descendre">
                    <Icon name="down" size={16} />
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
