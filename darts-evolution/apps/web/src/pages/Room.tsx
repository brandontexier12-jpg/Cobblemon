import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, Field, inputClass, PageHeader, Segmented, useUi } from "../components/ui";
import { api } from "../lib/api";
import { useLocalPreference } from "../lib/hooks";
import type { MatchSnapshot } from "../lib/types";

/** Rejoindre une partie depuis un autre appareil du réseau local, par son code de salle. */
export function RoomPage() {
  const { code: initial = "" } = useParams();
  const navigate = useNavigate();
  const { toast } = useUi();
  const [code, setCode] = useState(initial.toUpperCase());
  const [role, setRole] = useState<"player" | "spectator">("player");
  const [deviceName, setDeviceName] = useLocalPreference("deviceName", "Appareil");
  const join = async () => {
    try {
      const snapshot = await api.get<MatchSnapshot>(`/api/rooms/${encodeURIComponent(code.trim())}`);
      navigate(`/partie/${snapshot.match.id}${role === "spectator" ? "?role=spectator" : ""}`);
    } catch (e) {
      toast((e as Error).message, "critical");
    }
  };
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Rejoindre une salle" subtitle="Le code s'affiche en haut de l'écran de la partie (réseau local uniquement)." />
      <Card>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void join();
          }}
        >
          <Field label="Code de salle">
            <input
              className={`${inputClass} font-display text-center text-3xl tracking-[0.4em]`}
              value={code}
              maxLength={6}
              autoCapitalize="characters"
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            />
          </Field>
          <Field label="Rôle">
            <Segmented
              value={role}
              onChange={setRole}
              options={[
                { value: "player", label: "Joueur (saisie des scores)" },
                { value: "spectator", label: "Spectateur" },
              ]}
            />
          </Field>
          <Field label="Nom de cet appareil">
            <input className={inputClass} value={deviceName} maxLength={32} onChange={(e) => setDeviceName(e.target.value)} />
          </Field>
          <Button variant="primary" size="lg" className="w-full" type="submit" disabled={code.length < 6}>
            Rejoindre
          </Button>
        </form>
      </Card>
    </div>
  );
}
