"use client";

// Capture console with the fixture session (src/app/capture/preview, local mode only): no session, no transport.
import AgentAvatar from "@/components/agents/AgentAvatar";
import { captureFixture as f } from "@/lib/fixtures/capture";
import CaptureConsole from "./CaptureConsole";

const noop = () => {};

export default function CapturePreview() {
  return (
    <CaptureConsole
      running
      starting={false}
      offRecord={false}
      sharing
      shareWarning={null}
      expert={f.expert}
      agentName={f.agentName}
      avatar={<AgentAvatar avatar={null} state="listening" size={96} />}
      task={f.task}
      elapsed={f.elapsed}
      lastQuestion={f.lastQuestion}
      askedAt={f.askedAt}
      lastAnswer={f.lastAnswer}
      answerChips={f.answerChips}
      asked={f.asked}
      guardrailAsked={f.guardrailAsked}
      guardrails={f.guardrails}
      nextQuestionIn={f.nextQuestionIn}
      savedForDebrief={0}
      feed={f.feed}
      host="bridge"
      companion={{ status: "paired", permissions: f.permissions, onPair: () => false }}
      onExpertChange={noop}
      onStart={noop}
      onEnd={noop}
      onTogglePause={noop}
      onToggleOffRecord={noop}
      onToggleShare={noop}
    />
  );
}
