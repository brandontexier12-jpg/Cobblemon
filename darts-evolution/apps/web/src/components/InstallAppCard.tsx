import { useMemo } from "react";
import { encode } from "uqr";
import { isDesktopApp, isInstalledApp, isLocalOnlyHost, platform, promptInstall, useCanInstall } from "../lib/install";
import { Badge, Button, Card, useUi } from "./ui";

/** QR code de l'adresse actuelle, dessiné en SVG (un seul chemin, net à toutes les tailles). */
function QrCode({ text }: { text: string }) {
  const { size, path } = useMemo(() => {
    const qr = encode(text, { ecc: "M", border: 2 });
    let d = "";
    qr.data.forEach((row, y) => row.forEach((dark, x) => dark && (d += `M${x} ${y}h1v1h-1z`)));
    return { size: qr.size, path: d };
  }, [text]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-44 w-44 shrink-0 rounded-xl bg-white" role="img" aria-label={`QR code : ${text}`} shapeRendering="crispEdges">
      <path d={path} fill="#0b0b0c" />
    </svg>
  );
}

/** Paramètres → installer DARTS EVOLUTION comme une application sur le téléphone ou la tablette. */
export function InstallAppCard() {
  const { toast } = useUi();
  const canInstall = useCanInstall();
  const installed = isInstalledApp();
  const where = platform();
  const address = location.origin;
  const localOnly = isLocalOnlyHost();
  const install = async () => {
    if (await promptInstall()) toast("Application installée : son icône est sur l'écran d'accueil.", "good");
  };
  return (
    <Card title="Application sur téléphone" action={installed ? <Badge tone="good">{isDesktopApp() ? "Application Windows" : "Installée sur cet appareil"}</Badge> : undefined}>
      <div className="flex flex-col gap-5 md:flex-row">
        <div className="flex flex-col items-center gap-2">
          {localOnly ? (
            <div className="flex h-44 w-44 items-center justify-center rounded-xl border border-dashed border-ink-600 p-3 text-center text-xs text-ink-400">
              Ouvrez cette page avec l'adresse du NAS (par exemple http://192.168.1.50:8080) pour obtenir un QR code utilisable sur le téléphone.
            </div>
          ) : (
            <QrCode text={address} />
          )}
          <span className="font-mono text-xs text-ink-300">{address}</span>
        </div>
        <div className="min-w-0 flex-1 space-y-3 text-sm text-ink-200">
          <p>
            Scannez le QR code avec l'appareil photo du téléphone (connecté au wifi de la maison) pour ouvrir DARTS EVOLUTION, puis ajoutez-le à l'écran
            d'accueil : il s'ouvre ensuite comme une application, en plein écran, avec son icône. Joueurs, statistiques et carrière restent sur le serveur,
            les mêmes sur tous les appareils.
          </p>
          {canInstall && (
            <Button variant="primary" icon="download" onClick={() => void install()}>
              Installer l'application
            </Button>
          )}
          <ul className="space-y-2">
            <li className={where === "ios" ? "rounded-lg bg-brand-500/10 p-2 ring-1 ring-brand-500/30" : ""}>
              <strong className="text-ink-100">iPhone / iPad</strong> : ouvrez l'adresse dans <strong>Safari</strong>, touchez le bouton Partager (carré avec
              une flèche), puis « Sur l'écran d'accueil » → « Ajouter ».
            </li>
            <li className={where === "android" ? "rounded-lg bg-brand-500/10 p-2 ring-1 ring-brand-500/30" : ""}>
              <strong className="text-ink-100">Android</strong> : dans <strong>Chrome</strong>, menu ⋮ → « Ajouter à l'écran d'accueil » (ou « Installer
              l'application »).
              {!window.isSecureContext && (
                <span className="mt-1 block text-xs text-ink-400">
                  Avec une adresse en http comme celle du NAS, Chrome crée un raccourci ; l'application complète (plein écran, sans barre d'adresse) demande
                  une adresse https ou un réglage de Chrome expliqué dans la documentation (docs/applications.md).
                </span>
              )}
            </li>
            <li className={where === "desktop" && !isDesktopApp() ? "rounded-lg bg-brand-500/10 p-2 ring-1 ring-brand-500/30" : ""}>
              <strong className="text-ink-100">PC Windows</strong> : installez l'application DARTS EVOLUTION (fichier « DARTS-EVOLUTION-Setup-….exe ») et
              indiquez-lui l'adresse affichée sous le QR code au premier lancement.
            </li>
          </ul>
        </div>
      </div>
    </Card>
  );
}
