import { useState } from "react";
import { api } from "../lib/api";
import { useAppState } from "../lib/app-state";
import { Icon } from "./Icon";
import { Button, useUi } from "./ui";

/** Lance la calibration automatique des caméras Autodarts (toutes, ou une seule). */
export function CalibrateButton({ camera, size = "sm", label }: { camera?: number; size?: "sm" | "md"; label?: string }) {
  const { autodarts, refreshAutodarts } = useAppState();
  const { toast, confirm } = useUi();
  const [busy, setBusy] = useState(false);
  const running = busy || !!autodarts?.calibrating || autodarts?.status.boardStatus === "Calibrating";
  const connected = autodarts?.status.state === "connected";

  const run = async () => {
    const ok = await confirm({
      title: camera === undefined ? "Recalibrer les caméras ?" : `Recalibrer la caméra ${camera + 1} ?`,
      message:
        "Retirez d'abord toutes les fléchettes de la cible. La calibration automatique d'Autodarts dure jusqu'à une minute ; pendant ce temps, les impacts ne sont pas comptés. La partie en cours est conservée.",
      confirmLabel: "Recalibrer",
    });
    if (!ok) return;
    setBusy(true);
    toast("Calibration en cours… ne touchez pas la cible.", "info");
    try {
      const r = await api.post<{ message: string }>("/api/autodarts/calibrate", camera === undefined ? {} : { camera });
      toast(r.message, "good");
    } catch (e) {
      toast((e as Error).message, "critical");
    } finally {
      setBusy(false);
      void refreshAutodarts();
    }
  };

  return (
    <Button size={size} variant="ghost" disabled={running || !connected} onClick={run} title={connected ? undefined : "Autodarts n'est pas connecté"}>
      <Icon name={running ? "refresh" : "eye"} size={16} className={running ? "animate-spin" : undefined} />
      {running ? "Calibration…" : (label ?? (camera === undefined ? "Recalibrer" : `Caméra ${camera + 1}`))}
    </Button>
  );
}
