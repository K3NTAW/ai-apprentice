"use client";
// Local preview only (src/app/teach/preview): the Teach console with a live fixture session or the ended summary.
import { previewTeach } from "@/lib/fixtures/preview";
import TeachConsole from "./TeachConsole";

const noop = () => {};

export default function TeachPreview() {
  return (
    <TeachConsole
      options={[{ id: "pip-1", label: previewTeach.workmap.task }]}
      selected="pip-1"
      workmap={previewTeach.workmap}
      banner={null}
      workmapSessionId="pip-1"
      running
      starting={false}
      paused={false}
      sharing
      shareWarning={null}
      notice={null}
      textMode={false}
      host="websocket"
      companion={{ status: "paired", permissions: null, onPair: () => false }}
      agentName="Pip"
      currentStep={previewTeach.currentStep}
      transcript={previewTeach.transcript}
      intervention={previewTeach.intervention}
      replayOpen={false}
      stats={previewTeach.stats}
      result={null}
      onSelect={noop}
      onStart={noop}
      onToggleShare={noop}
      onTogglePause={noop}
      onEnd={noop}
      onReplay={noop}
      onAnswer={noop}
    />
  );
}
