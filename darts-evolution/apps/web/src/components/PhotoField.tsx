import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Icon } from "./Icon";
import { Button, PlayerAvatar, useUi } from "./ui";

const VIEW = 240;
const OUTPUT = 320;

/** Modification de photo : `undefined` inchangée, `null` à retirer, Blob à envoyer. */
export type PhotoChange = Blob | null | undefined;

interface Crop {
  img: HTMLImageElement;
  url: string;
  zoom: number;
  x: number;
  y: number;
}

function baseScale(img: HTMLImageElement): number {
  return VIEW / Math.min(img.naturalWidth, img.naturalHeight);
}

/** Garde l'image entièrement sous le cadre (pas de bord vide). */
function clampCrop(c: Crop): Crop {
  const scale = baseScale(c.img) * c.zoom;
  const w = c.img.naturalWidth * scale;
  const h = c.img.naturalHeight * scale;
  return { ...c, x: Math.min(0, Math.max(VIEW - w, c.x)), y: Math.min(0, Math.max(VIEW - h, c.y)) };
}

/**
 * Photo de profil : choix d'une image (galerie ou appareil photo), recadrage carré (glisser pour
 * cadrer, curseur pour zoomer), puis réduction en JPEG 320 × 320 avant l'envoi : la photo reste
 * légère dans la base et dans les sauvegardes.
 */
export function PhotoField({ avatar, color, current, value, onChange }: { avatar: string; color: string; current: string | null; value: PhotoChange; onChange: (v: PhotoChange) => void }) {
  const { toast } = useUi();
  const input = useRef<HTMLInputElement>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!(value instanceof Blob)) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(value);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);
  useEffect(() => {
    const url = crop?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [crop?.url]);

  const shown = value === null ? null : (preview ?? current);

  const pick = (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = baseScale(img);
      setCrop({ img, url, zoom: 1, x: (VIEW - img.naturalWidth * scale) / 2, y: (VIEW - img.naturalHeight * scale) / 2 });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast("Image illisible : choisissez une photo JPEG, PNG ou WebP.", "critical");
    };
    img.src = url;
  };

  const zoomTo = (zoom: number) => {
    if (!crop) return;
    // Zoom autour du centre du cadre.
    const before = baseScale(crop.img) * crop.zoom;
    const after = baseScale(crop.img) * zoom;
    const cx = (VIEW / 2 - crop.x) / before;
    const cy = (VIEW / 2 - crop.y) / before;
    setCrop(clampCrop({ ...crop, zoom, x: VIEW / 2 - cx * after, y: VIEW / 2 - cy * after }));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!crop) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: crop.x, y: crop.y };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!crop || !drag.current) return;
    setCrop(clampCrop({ ...crop, x: drag.current.x + e.clientX - drag.current.px, y: drag.current.y + e.clientY - drag.current.py }));
  };

  const confirm = () => {
    if (!crop) return;
    const scale = baseScale(crop.img) * crop.zoom;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(crop.img, -crop.x / scale, -crop.y / scale, VIEW / scale, VIEW / scale, 0, 0, OUTPUT, OUTPUT);
    canvas.toBlob(
      (blob) => {
        if (blob) onChange(blob);
        else toast("La photo n'a pas pu être préparée.", "critical");
        setCrop(null);
      },
      "image/jpeg",
      0.88,
    );
  };

  if (crop) {
    const scale = baseScale(crop.img) * crop.zoom;
    return (
      <div className="space-y-3">
        <div
          className="relative mx-auto touch-none select-none overflow-hidden rounded-2xl bg-ink-950"
          style={{ width: VIEW, height: VIEW, cursor: drag.current ? "grabbing" : "grab" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          role="img"
          aria-label="Cadrage de la photo : faites glisser pour cadrer"
        >
          <img
            src={crop.url}
            alt=""
            draggable={false}
            className="pointer-events-none absolute left-0 top-0 max-w-none"
            style={{ width: crop.img.naturalWidth * scale, height: crop.img.naturalHeight * scale, transform: `translate(${crop.x}px, ${crop.y}px)` }}
          />
          {/* Rond de l'avatar : ce qui sera visible dans l'application */}
          <div className="pointer-events-none absolute inset-0 rounded-full" style={{ boxShadow: "0 0 0 999px rgba(0,0,0,0.55)" }} />
        </div>
        <label className="mx-auto flex max-w-[240px] items-center gap-2 text-sm text-ink-300">
          <span>Zoom</span>
          <input type="range" min={1} max={4} step={0.01} value={crop.zoom} onChange={(e) => zoomTo(Number(e.target.value))} className="flex-1 accent-[#ff6b1a]" aria-label="Zoom" />
        </label>
        <p className="text-center text-xs text-ink-400">Faites glisser la photo pour la cadrer dans le rond.</p>
        <div className="flex justify-center gap-2">
          <Button variant="ghost" onClick={() => setCrop(null)}>
            Annuler
          </Button>
          <Button variant="primary" icon="check" onClick={confirm}>
            Utiliser cette photo
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <PlayerAvatar avatar={avatar} color={color} photo={shown} size={64} />
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) pick(file);
        }}
      />
      <Button size="sm" icon="upload" onClick={() => input.current?.click()}>
        {shown ? "Changer la photo" : "Choisir une photo"}
      </Button>
      {shown && (
        <Button size="sm" variant="ghost" icon="trash" onClick={() => onChange(current ? null : undefined)}>
          Retirer
        </Button>
      )}
      {!shown && (
        <span className="flex items-center gap-1 text-xs text-ink-400">
          <Icon name="info" size={14} /> Sans photo, l'avatar ci-dessous est utilisé.
        </span>
      )}
    </div>
  );
}
