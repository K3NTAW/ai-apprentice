"use client";
// Avatar studio: live preview, shape/face/colour pickers, animation buttons, randomize, save and export.
// Also usable as the create flow's avatar step via onChange (no agentId/saver needed).
import { useEffect, useMemo, useReducer, useState } from "react";
import { downloadBlob, exportFilename, pngBlob, svgBlob } from "@/lib/avatar/export";
import {
  AVATAR_FACES,
  AVATAR_PALETTE,
  AVATAR_SHAPES,
  AVATAR_STATES,
  type Avatar,
  isHexColor,
  renderAvatarSvg,
  toDataUrl,
} from "@/lib/avatar/render";
import type { AvatarSaver } from "@/lib/avatar/save";
import { initStudio, previewSvg, studioReducer } from "./studioModel";

type Props = {
  agentId?: string;
  name?: string;
  initialAvatar?: Avatar;
  saver?: AvatarSaver;
  onChange?: (avatar: Avatar) => void;
};

const chip = (active: boolean) =>
  `rounded-full border px-3 py-1 text-sm capitalize ${active ? "border-[var(--pb)] bg-[var(--pb)] text-[var(--pf)]" : "border-[var(--ln2)] bg-[var(--s2)] text-[var(--tx)] hover:border-[var(--mu)]"}`;

function ColorPicker({ label, value, onPick }: { label: string; value: string; onPick: (hex: string) => void }) {
  const [custom, setCustom] = useState(value);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="ui-lbl">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {AVATAR_PALETTE.map((hex) => (
          <button
            key={hex}
            type="button"
            aria-label={`${label} ${hex}`}
            aria-pressed={value === hex}
            onClick={() => onPick(hex)}
            className={`h-7 w-7 rounded-full border-2 ${value === hex ? "border-white" : "border-transparent"}`}
            style={{ backgroundColor: hex }}
          />
        ))}
      </div>
      <input
        aria-label={`${label} custom hex`}
        value={custom}
        maxLength={7}
        onChange={(e) => {
          setCustom(e.target.value);
          if (isHexColor(e.target.value)) onPick(e.target.value);
        }}
        className="ui-inp ui-mono w-28"
      />
    </fieldset>
  );
}

export default function AvatarStudio({ agentId, name = "avatar", initialAvatar, saver, onChange }: Props) {
  const [model, dispatch] = useReducer(studioReducer, initialAvatar, initStudio);
  const [status, setStatus] = useState("");
  const src = useMemo(() => toDataUrl(previewSvg(model, 256)), [model]);

  useEffect(() => {
    onChange?.(model.avatar);
  }, [model.avatar, onChange]);

  const save = async () => {
    if (!saver || !agentId) return;
    setStatus("Saving...");
    try {
      await saver.save(agentId, model.avatar);
      setStatus("Saved");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Save failed");
    }
  };

  const exportSvg = () => downloadBlob(svgBlob(renderAvatarSvg(model.avatar, model.state, 512)), exportFilename(name, "svg"));
  const exportPng = async () => {
    try {
      downloadBlob(await pngBlob(renderAvatarSvg(model.avatar, model.state, 512)), exportFilename(name, "png"));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "PNG export failed");
    }
  };

  return (
    <section className="ui-card grid gap-6 overflow-hidden p-6 md:grid-cols-[320px_1fr]" data-screen="avatar-studio">
      <div className="flex flex-col items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL preview, same path the companion uses */}
        <img src={src} alt={`${name} avatar, ${model.state}`} width={256} height={256} className="rounded-[12px] bg-[var(--stage)]" />
        <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Animations">
          {AVATAR_STATES.map((st) => (
            <button key={st} type="button" aria-pressed={model.state === st} className={chip(model.state === st)} onClick={() => dispatch({ type: "play", state: st })}>
              {st}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-5">
        <fieldset className="flex flex-col gap-2">
          <legend className="ui-lbl">Shape</legend>
          <div className="flex flex-wrap gap-2">
            {AVATAR_SHAPES.map((s) => (
              <button key={s} type="button" aria-pressed={model.avatar.shape === s} className={chip(model.avatar.shape === s)} onClick={() => dispatch({ type: "shape", shape: s })}>
                {s}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="ui-lbl">Face</legend>
          <div className="flex flex-wrap gap-2">
            {AVATAR_FACES.map((f) => (
              <button key={f} type="button" aria-pressed={model.avatar.face === f} className={chip(model.avatar.face === f)} onClick={() => dispatch({ type: "face", face: f })}>
                {f}
              </button>
            ))}
          </div>
        </fieldset>
        <ColorPicker label="Body colour" value={model.avatar.color} onPick={(color) => dispatch({ type: "color", color })} />
        <ColorPicker label="Accent" value={model.avatar.accent} onPick={(accent) => dispatch({ type: "accent", accent })} />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={chip(false)} onClick={() => dispatch({ type: "randomize" })}>
            Randomize
          </button>
          {saver && agentId && (
            <button type="button" className={chip(true)} onClick={save}>
              Save
            </button>
          )}
          <button type="button" className={chip(false)} onClick={exportSvg}>
            Export SVG
          </button>
          <button type="button" className={chip(false)} onClick={exportPng}>
            Export PNG
          </button>
          <span role="status" className="text-sm" style={{ color: "var(--mu)" }}>
            {status}
          </span>
        </div>
      </div>
    </section>
  );
}
