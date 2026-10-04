"use client";
// Avatar studio: live preview, shape/face/colour pickers, animation buttons, randomize, save and export.
// Also usable as the create flow's avatar step via onChange (no agentId/saver needed).
import Link from "next/link";
import { useEffect, useMemo, useReducer, useState } from "react";
import { buttonClass } from "@/components/ui";
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
  /** Full-page studio (Studio.dc.html) with a back link instead of the inline card. */
  page?: { backHref: string; backLabel: string };
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

export default function AvatarStudio({ agentId, name = "avatar", initialAvatar, saver, onChange, page }: Props) {
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

  const stateChips = (
    <div className={`flex flex-wrap gap-2 ${page ? "" : "justify-center"}`} role="group" aria-label="Animations">
      {AVATAR_STATES.map((st) => (
        <button key={st} type="button" aria-pressed={model.state === st} className={chip(model.state === st)} onClick={() => dispatch({ type: "play", state: st })}>
          {st}
        </button>
      ))}
    </div>
  );
  const pickers = (
    <>
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
    </>
  );
  const statusLine = (
    <span role="status" className="text-sm" style={{ color: "var(--mu)" }}>
      {status}
    </span>
  );

  if (page) {
    // Studio.dc.html: full-width top bar with the actions, the stage on the left, the pickers in a 380 px side panel.
    return (
      <section className="flex min-h-screen flex-col" data-screen="avatar-studio">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--ln)] px-6 py-3.5 sm:px-10">
          <div className="flex items-center gap-4">
            <Link href={page.backHref} className={buttonClass("ghost", "sm")}>
              <svg className="ui-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
              {page.backLabel}
            </Link>
            <span className="h-5 w-px" style={{ background: "var(--ln2)" }} />
            <h1 className="text-base font-semibold">Avatar studio</h1>
            <span className="text-xs" style={{ color: "var(--fa)" }}>Changes save to this agent only</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {statusLine}
            <button type="button" className={buttonClass("secondary")} onClick={() => dispatch({ type: "randomize" })}>
              <svg className="ui-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>
              Randomize
            </button>
            <button type="button" className={buttonClass("secondary")} onClick={exportPng}>
              <svg className="ui-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
              Export PNG
            </button>
            <button type="button" className={buttonClass("secondary")} onClick={exportSvg}>
              <svg className="ui-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
              Export SVG
            </button>
            {saver && agentId && (
              <button type="button" className={buttonClass("primary")} onClick={save}>
                Save
              </button>
            )}
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-wrap">
          <div className="flex min-w-0 flex-col gap-4 p-6" style={{ flex: "999 1 560px" }}>
            <div className="ui-card relative flex min-h-[640px] flex-1 flex-col items-center justify-center gap-6 overflow-hidden" style={{ background: "var(--stage)" }}>
              <div className="ui-mono absolute top-[18px] left-5 text-xs" style={{ color: "var(--fa)" }}>
                {model.avatar.shape} · {model.avatar.face} · {model.avatar.color} / {model.avatar.accent}
              </div>
              <div className="ui-mono absolute top-4 right-5 text-xs" style={{ color: "var(--mu)" }}>State: {model.state}</div>
              {/* eslint-disable-next-line @next/next/no-img-element -- data URL preview, same path the companion uses */}
              <img src={src} alt={`${name} avatar, ${model.state}`} width={320} height={320} />
              <div className="ui-t2 text-center">{page.backLabel}</div>
            </div>
            <div className="flex flex-col gap-2.5">
              <span className="ui-lbl">Play an animation</span>
              {stateChips}
            </div>
          </div>
          <aside className="flex min-w-0 flex-col gap-[26px] border-l border-[var(--ln)] p-6" style={{ flex: "1 0 380px", background: "var(--s1)" }}>
            {pickers}
          </aside>
        </div>
      </section>
    );
  }

  return (
    <section className="ui-card grid gap-6 overflow-hidden p-6 md:grid-cols-[320px_1fr]" data-screen="avatar-studio">
      <div className="flex flex-col items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL preview, same path the companion uses */}
        <img src={src} alt={`${name} avatar, ${model.state}`} width={256} height={256} className="rounded-[12px] bg-[var(--stage)]" />
        {stateChips}
      </div>
      <div className="flex flex-col gap-5">
        {pickers}
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
          {statusLine}
        </div>
      </div>
    </section>
  );
}
