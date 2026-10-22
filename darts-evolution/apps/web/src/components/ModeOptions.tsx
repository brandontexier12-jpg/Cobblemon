import type { ReactNode } from "react";
import type { GameModeId } from "../lib/types";
import { Field, inputClass, Segmented, Stepper, Toggle } from "./ui";

type Options = Record<string, unknown>;

const RULES = [
  { value: "single", label: "Simple" },
  { value: "double", label: "Double" },
  { value: "master", label: "Master" },
];

const ALL_SEGMENTS = [...Array.from({ length: 20 }, (_, i) => i + 1), 25];

function SegmentPicker({ value, onChange, allowBull }: { value: number[]; onChange: (v: number[]) => void; allowBull: boolean }) {
  const list = allowBull ? ALL_SEGMENTS : ALL_SEGMENTS.slice(0, 20);
  const toggle = (n: number) => onChange(value.includes(n) ? value.filter((v) => v !== n) : [...value, n].sort((a, b) => a - b));
  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5 sm:grid-cols-11">
        {list.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => toggle(n)}
            aria-pressed={value.includes(n)}
            className={`press min-h-10 rounded-lg border text-sm font-semibold ${value.includes(n) ? "border-brand-500 bg-brand-500/20 text-brand-300" : "border-ink-600 bg-ink-900 text-ink-300"}`}
          >
            {n === 25 ? "Bull" : n}
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-3 text-sm">
        <button type="button" className="text-ink-300 hover:text-ink-100" onClick={() => onChange(list)}>
          Tout
        </button>
        <button type="button" className="text-ink-300 hover:text-ink-100" onClick={() => onChange([20, 19, 18, 17, 16, 15].filter((n) => list.includes(n)))}>
          Haut de cible (15–20)
        </button>
        <button type="button" className="text-ink-300 hover:text-ink-100" onClick={() => onChange([20, 16, 8, 10, 18, 12])}>
          Doubles favoris
        </button>
      </div>
    </div>
  );
}

const RING_LABEL: Record<string, string> = { any: "Tout", single: "Simple", double: "Double", triple: "Triple", outer_bull: "25", inner_bull: "Bull" };

function TargetListEditor({ value, onChange }: { value: { segment: number; ring: string }[]; onChange: (v: { segment: number; ring: string }[]) => void }) {
  const add = (segment: number, ring: string) => onChange([...value, { segment, ring }]);
  return (
    <div className="space-y-2">
      <div className="flex min-h-12 flex-wrap gap-1.5 rounded-xl border border-ink-700 bg-ink-900 p-2">
        {value.length === 0 && <span className="text-sm text-ink-400">Ajoutez des cibles ci-dessous.</span>}
        {value.map((t, i) => (
          <button key={i} type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="press rounded-lg bg-ink-700 px-2 py-1 text-sm" title="Retirer">
            {t.segment === 25 ? RING_LABEL[t.ring] ?? "Bull" : `${t.ring === "any" ? "" : RING_LABEL[t.ring]!.charAt(0)}${t.segment}`} ✕
          </button>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
        {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
          <div key={n} className="flex flex-col gap-1">
            {(["single", "double", "triple"] as const).map((ring) => (
              <button key={ring} type="button" onClick={() => add(n, ring)} className="press rounded-md border border-ink-700 bg-ink-850 py-1 text-xs text-ink-200 hover:border-ink-500">
                {ring.charAt(0).toUpperCase()}
                {n}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button type="button" className="press rounded-md border border-ink-700 bg-ink-850 px-3 py-1.5 text-sm" onClick={() => add(25, "outer_bull")}>
          + 25
        </button>
        <button type="button" className="press rounded-md border border-ink-700 bg-ink-850 px-3 py-1.5 text-sm" onClick={() => add(25, "inner_bull")}>
          + Bull
        </button>
        <button type="button" className="press rounded-md border border-ink-700 bg-ink-850 px-3 py-1.5 text-sm" onClick={() => add(25, "any")}>
          + Bull (25/50)
        </button>
      </div>
    </div>
  );
}

/** Formulaire d'options propre à chaque mode (valeurs par défaut fournies par le serveur). */
export function ModeOptionsForm({ mode, options, onChange }: { mode: GameModeId; options: Options; onChange: (o: Options) => void }) {
  const set = (key: string, value: unknown) => onChange({ ...options, [key]: value });
  const num = (key: string, fallback: number) => (typeof options[key] === "number" ? (options[key] as number) : fallback);
  const bool = (key: string, fallback: boolean) => (typeof options[key] === "boolean" ? (options[key] as boolean) : fallback);
  const str = (key: string, fallback: string) => (typeof options[key] === "string" ? (options[key] as string) : fallback);
  const rows: ReactNode[] = [];

  const progressionFields = () => (
    <>
      <Field label="Progression">
        <Segmented
          value={str("progression", "fixed")}
          onChange={(v) => set("progression", v)}
          options={[
            { value: "fixed", label: "N fléchettes par cible" },
            { value: "until_hit", label: "Jusqu'à la touche" },
          ]}
        />
      </Field>
      {str("progression", "fixed") === "fixed" ? (
        <Field label="Fléchettes par cible">
          <Stepper value={num("dartsPerTarget", 3)} min={1} max={30} onChange={(v) => set("dartsPerTarget", v)} />
        </Field>
      ) : (
        <Field label="Plafond de fléchettes par cible" hint="0 = sans limite">
          <Stepper value={num("maxDartsPerTarget", 0)} min={0} max={99} onChange={(v) => set("maxDartsPerTarget", v)} />
        </Field>
      )}
      <Field label="Ordre">
        <Segmented
          value={str("order", "sequential")}
          onChange={(v) => set("order", v)}
          options={[
            { value: "sequential", label: "Dans l'ordre" },
            { value: "random", label: "Aléatoire" },
          ]}
        />
      </Field>
      <Field label="Objectif de réussite (%)" hint="Optionnel : affiché pendant la séance">
        <Stepper value={num("goalPercent", 0)} min={0} max={100} step={5} onChange={(v) => set("goalPercent", v === 0 ? undefined : v)} />
      </Field>
    </>
  );

  switch (mode) {
    case "x01":
      rows.push(
        <Field key="start" label="Score de départ">
          <Segmented value={num("startScore", 501)} onChange={(v) => set("startScore", v)} options={[301, 501, 701, 901, 1001].map((v) => ({ value: v, label: String(v) }))} />
        </Field>,
        <Field key="in" label="Départ">
          <Segmented value={str("inRule", "single")} onChange={(v) => set("inRule", v)} options={RULES} />
        </Field>,
        <Field key="out" label="Sortie" hint="« Simple » : terminer à 0 avec n'importe quelle fléchette, sans obligation de double.">
          <Segmented value={str("outRule", "double")} onChange={(v) => set("outRule", v)} options={RULES} />
        </Field>,
        <div key="ls" className="flex flex-wrap gap-6">
          <Field label="Legs (premier à)">
            <Stepper value={num("legs", 1)} min={1} max={21} onChange={(v) => set("legs", v)} />
          </Field>
          <Field label="Sets (premier à)" hint="1 = sans sets">
            <Stepper value={num("sets", 1)} min={1} max={13} onChange={(v) => set("sets", v)} />
          </Field>
        </div>,
        <Field key="strat" label="Stratégie de checkout">
          <Segmented
            value={str("checkoutStrategy", "classique")}
            onChange={(v) => set("checkoutStrategy", v)}
            options={[
              { value: "classique", label: "Classique" },
              { value: "bull", label: "Privilégier le bull" },
              { value: "double_favori", label: "Double favori" },
            ]}
          />
        </Field>,
      );
      if (str("checkoutStrategy", "classique") === "double_favori") {
        rows.push(
          <Field key="fav" label="Double favori">
            <select className={inputClass} value={num("favoriteDouble", 20)} onChange={(e) => set("favoriteDouble", Number(e.target.value))}>
              {[...Array.from({ length: 20 }, (_, i) => 20 - i), 25].map((n) => (
                <option key={n} value={n}>
                  {n === 25 ? "Bull" : `D${n}`}
                </option>
              ))}
            </select>
          </Field>,
        );
      }
      break;
    case "cricket":
      rows.push(
        <Field key="v" label="Variante">
          <Segmented
            value={str("variant", "standard")}
            onChange={(v) => set("variant", v)}
            options={[
              { value: "standard", label: "Classique" },
              { value: "cut_throat", label: "Cut-throat" },
            ]}
          />
        </Field>,
        <Field key="r" label="Manches maximum" hint="0 = illimité">
          <Stepper value={num("maxRounds", 20)} min={0} max={99} onChange={(v) => set("maxRounds", v)} />
        </Field>,
      );
      break;
    case "count_up":
      rows.push(
        <Field key="t" label="Total à atteindre">
          <Segmented value={num("target", 300)} onChange={(v) => set("target", v)} options={[200, 300, 500, 1000].map((v) => ({ value: v, label: String(v) }))} />
        </Field>,
      );
      break;
    case "high_score":
      rows.push(
        <Field key="r" label="Nombre de manches">
          <Stepper value={num("rounds", 10)} min={1} max={50} onChange={(v) => set("rounds", v)} />
        </Field>,
      );
      break;
    case "around_the_clock":
      rows.push(
        <Field key="ring" label="Zone qui compte">
          <Segmented
            value={str("ring", "any")}
            onChange={(v) => set("ring", v)}
            options={[
              { value: "any", label: "Tout le secteur" },
              { value: "single", label: "Simples" },
              { value: "double", label: "Doubles" },
              { value: "triple", label: "Triples" },
            ]}
          />
        </Field>,
        <Toggle key="bull" checked={bool("includeBull", true)} onChange={(v) => set("includeBull", v)} label="Terminer par le bull" />,
        <Toggle key="skip" checked={bool("skipOnMultiplier", false)} onChange={(v) => set("skipOnMultiplier", v)} label="Double = +2, triple = +3 (zone « tout le secteur »)" />,
      );
      break;
    case "around_the_world":
    case "bobs_27":
      rows.push(<Toggle key="bull" checked={bool("includeBull", mode === "around_the_world")} onChange={(v) => set("includeBull", v)} label="Inclure une manche au bull" />);
      break;
    case "killer": {
      const variant = str("variant", "remplissage");
      const classic = variant === "classique";
      rows.push(
        <Field key="v" label="Règle">
          <Segmented
            value={variant}
            onChange={(v) => onChange({ ...options, variant: v, zone: undefined, selfPenalty: undefined })}
            options={[
              { value: "remplissage", label: "Remplissage (règle courante)" },
              { value: "classique", label: "Classique (un double)" },
            ]}
          />
        </Field>,
        <Field key="l" label={classic ? "Vies de départ" : "Vies pour devenir Killer"}>
          <Stepper value={num("lives", 3)} min={1} max={9} onChange={(v) => set("lives", v)} />
        </Field>,
        <Field key="z" label="Zone">
          <Segmented
            value={str("zone", classic ? "double" : "any")}
            onChange={(v) => set("zone", v)}
            options={[
              { value: "any", label: "Tout le numéro (simple 1, double 2, triple 3)" },
              { value: "double", label: "Doubles seulement" },
            ]}
          />
        </Field>,
        <Toggle key="p" checked={bool("selfPenalty", classic)} onChange={(v) => set("selfPenalty", v)} label="Un Killer qui touche son propre numéro perd des vies" />,
        ...(classic
          ? []
          : [
              <Toggle
                key="f"
                checked={bool("firstRoundProtection", true)}
                onChange={(v) => set("firstRoundProtection", v)}
                label="Personne n'est éliminé pendant le premier tour"
              />,
            ]),
        <p key="n" className="text-sm text-ink-400">
          {classic
            ? "On part avec toutes ses vies ; un double de son numéro fait Killer."
            : "On remplit son numéro jusqu'au maximum de vies pour devenir Killer ; un Killer touché repasse en dessous et doit remplir à nouveau."}{" "}
          Les numéros sont tirés au sort au lancement de la partie (roue).
        </p>,
      );
      break;
    }
    case "shanghai":
      rows.push(
        <Field key="r" label="Nombre de manches">
          <Stepper value={num("rounds", 7)} min={1} max={20} onChange={(v) => set("rounds", v)} />
        </Field>,
        <Toggle key="w" checked={bool("instantWin", true)} onChange={(v) => set("instantWin", v)} label="Victoire immédiate sur un Shanghai" />,
      );
      break;
    case "doubles_training":
    case "triples_training":
      rows.push(
        <Field key="s" label={mode === "doubles_training" ? "Doubles travaillés" : "Triples travaillés"}>
          <SegmentPicker
            allowBull={mode === "doubles_training"}
            value={(options.segments as number[]) ?? (mode === "doubles_training" ? ALL_SEGMENTS.slice(0, 20) : [20, 19, 18, 17, 16, 15])}
            onChange={(v) => set("segments", v)}
          />
        </Field>,
        progressionFields(),
      );
      break;
    case "bull_training":
      rows.push(
        <Field key="r" label="Manches de 3 fléchettes">
          <Stepper value={num("rounds", 10)} min={1} max={50} onChange={(v) => set("rounds", v)} />
        </Field>,
        <Field key="ring" label="Cible">
          <Segmented
            value={str("ring", "any")}
            onChange={(v) => set("ring", v)}
            options={[
              { value: "any", label: "Bull complet (25 et 50)" },
              { value: "inner_bull", label: "Bull intérieur uniquement" },
            ]}
          />
        </Field>,
      );
      break;
    case "checkout_training":
      rows.push(
        <Field key="sel" label="Scores">
          <Segmented
            value={str("selection", "random")}
            onChange={(v) => set("selection", v)}
            options={[
              { value: "random", label: "Tirage aléatoire" },
              { value: "list", label: "Liste personnalisée" },
            ]}
          />
        </Field>,
      );
      if (str("selection", "random") === "random") {
        rows.push(
          <div key="range" className="flex flex-wrap gap-6">
            <Field label="Nombre de scores">
              <Stepper value={num("count", 10)} min={1} max={60} onChange={(v) => set("count", v)} />
            </Field>
            <Field label="Minimum">
              <Stepper value={num("min", 40)} min={2} max={170} step={5} onChange={(v) => set("min", v)} />
            </Field>
            <Field label="Maximum">
              <Stepper value={num("max", 100)} min={2} max={170} step={5} onChange={(v) => set("max", v)} />
            </Field>
          </div>,
        );
      } else {
        rows.push(
          <Field key="values" label="Scores à terminer" hint="Séparés par des virgules, ex. 40, 81, 121, 170">
            <input
              className={inputClass}
              defaultValue={((options.values as number[]) ?? []).join(", ")}
              onChange={(e) =>
                set(
                  "values",
                  e.target.value
                    .split(/[,;\s]+/)
                    .map(Number)
                    .filter((n) => Number.isInteger(n) && n > 1),
                )
              }
            />
          </Field>,
        );
      }
      rows.push(
        <Field key="vis" label="Visites autorisées par score">
          <Stepper value={num("visitsPerTarget", 1)} min={1} max={5} onChange={(v) => set("visitsPerTarget", v)} />
        </Field>,
        <Field key="out" label="Sortie">
          <Segmented value={str("outRule", "double")} onChange={(v) => set("outRule", v)} options={RULES} />
        </Field>,
      );
      break;
    case "custom_training":
      rows.push(
        <Field key="name" label="Nom de l'exercice">
          <input className={inputClass} value={str("name", "Exercice personnalisé")} maxLength={60} onChange={(e) => set("name", e.target.value)} />
        </Field>,
        <Field key="targets" label="Cibles">
          <TargetListEditor value={(options.targets as { segment: number; ring: string }[]) ?? []} onChange={(v) => set("targets", v)} />
        </Field>,
        progressionFields(),
        <Field key="rounds" label="Répétitions de la liste">
          <Stepper value={num("rounds", 1)} min={1} max={10} onChange={(v) => set("rounds", v)} />
        </Field>,
      );
      break;
  }
  return <div className="space-y-4">{rows}</div>;
}
