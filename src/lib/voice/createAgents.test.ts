import { describe, expect, it } from "vitest";
import { buildAgentBodies } from "./createAgents";
import * as prompts from "./prompts";

const { interviewer, tutor } = buildAgentBodies(prompts);

function tool(body: typeof interviewer, name: string) {
  const t = body.conversation_config.agent.prompt.tools.find((x) => x.name === name);
  expect(t).toBeDefined();
  return t!;
}

describe("buildAgentBodies", () => {
  it("builds the interviewer body", () => {
    expect(interviewer.name).toBe("Apprentice Interviewer");
    expect(interviewer.conversation_config.tts.voice_id).toBe("EXAVITQu4vr4xnSDxMaL");
    expect(interviewer.conversation_config.agent.prompt.prompt).toBe(prompts.INTERVIEWER_PROMPT);
    expect(interviewer.conversation_config.agent.first_message).toBe(prompts.INTERVIEWER_FIRST_MESSAGE);
    expect(interviewer.conversation_config.agent.language).toBe("en");
    expect(interviewer.conversation_config.agent.prompt.tools.map((t) => t.name)).toEqual([
      "set_off_record",
      "confirm_teach_back",
    ]);

    const off = tool(interviewer, "set_off_record");
    expect(off.type).toBe("client");
    expect(off.expects_response).toBe(true);
    expect(off.parameters.required).toEqual(["active"]);
    expect(off.parameters.properties.active.type).toBe("boolean");

    const tb = tool(interviewer, "confirm_teach_back");
    expect(tb.expects_response).toBe(true);
    expect(tb.parameters.required).toEqual(["confirmed"]);
    expect(tb.parameters.properties.confirmed.type).toBe("boolean");
    expect(tb.parameters.properties.correction.type).toBe("string");
    expect(interviewer.conversation_config.agent.dynamic_variables).toBeUndefined();
  });

  it("builds the tutor body", () => {
    expect(tutor.name).toBe("Apprentice Tutor");
    expect(tutor.conversation_config.tts.voice_id).toBe("JBFqnCBsd6RMkjVDRZzb");
    expect(tutor.conversation_config.agent.prompt.prompt).toBe(prompts.TUTOR_PROMPT);
    expect(tutor.conversation_config.agent.first_message).toBe(prompts.TUTOR_FIRST_MESSAGE);
    expect(tutor.conversation_config.agent.prompt.tools.map((t) => t.name)).toEqual(["replay_moment"]);

    const replay = tool(tutor, "replay_moment");
    expect(replay.expects_response).toBe(true);
    expect(replay.parameters.required).toEqual(["step_n"]);
    expect(replay.parameters.properties.step_n.type).toBe("number");

    const vars = tutor.conversation_config.agent.dynamic_variables?.dynamic_variable_placeholders;
    expect(Object.keys(vars ?? {}).sort()).toEqual(["expert", "work_map"]);
    expect(typeof vars?.expert).toBe("string");
    expect(typeof vars?.work_map).toBe("string");
  });

  it("enables overrides and auth, and honours the LLM override", () => {
    for (const b of [interviewer, tutor]) {
      expect(b.platform_settings.overrides.conversation_config_override.agent).toEqual({
        prompt: { prompt: true },
        first_message: true,
        language: true,
      });
      expect(b.platform_settings.auth.enable_auth).toBe(true);
    }
    const custom = buildAgentBodies(prompts, { llm: "gemini-3.5-flash" });
    expect(custom.tutor.conversation_config.agent.prompt.llm).toBe("gemini-3.5-flash");
  });
});
