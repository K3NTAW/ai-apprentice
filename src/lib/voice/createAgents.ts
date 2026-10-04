// Request bodies for POST /v1/convai/agents/create, used by scripts/create-agents.mjs.
// Pure and erasable-only TypeScript so Node can import it directly (type stripping).
// The prompts are passed in, not imported, so Node does not need to resolve extensionless
// imports; callers pass the constants from ./prompts.ts. Field shapes: see the doc URLs in
// scripts/create-agents.mjs.

export const INTERVIEWER_NAME = "Apprentice Interviewer";
export const TUTOR_NAME = "Apprentice Tutor";
export const INTERVIEWER_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"; // Sarah
export const TUTOR_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"; // George
export const DEFAULT_LLM = "gemini-2.5-flash";
// Expressive Mode only applies to v3 models (API reference: tts.expressive_mode).
export const DEFAULT_TTS_MODEL = "eleven_v3_conversational";

export type AgentPrompts = {
  INTERVIEWER_PROMPT: string;
  INTERVIEWER_FIRST_MESSAGE: string;
  TUTOR_PROMPT: string;
  TUTOR_FIRST_MESSAGE: string;
};

export type BuildOptions = { llm?: string; ttsModel?: string };

type LiteralProp = { type: "boolean" | "string" | "number"; description: string };

export type ClientTool = {
  type: "client";
  name: string;
  description: string;
  expects_response: boolean;
  response_timeout_secs: number;
  parameters: { type: "object"; required: string[]; properties: Record<string, LiteralProp> };
};

/**
 * ElevenLabs system tool skip_turn (OpenAPI 2026-10-04: PromptAgentAPIModel.built_in_tools.skip_turn, a
 * SystemToolConfig with params.system_tool_type "skip_turn"). The agent calls it to stay silent for a turn,
 * so expert narration without a control tag is not answered. wait_timeout_secs -1: no check-in after the skip.
 */
export type SystemTool = {
  type: "system";
  name: "skip_turn";
  description: string;
  params: { system_tool_type: "skip_turn"; wait_timeout_secs: number };
};

export const SKIP_TURN_TOOL: SystemTool = {
  type: "system",
  name: "skip_turn",
  description: "Stay silent this turn. Call it for every user turn that does not start with one of your control tags.",
  params: { system_tool_type: "skip_turn", wait_timeout_secs: -1 },
};

export type AgentCreateBody = {
  name: string;
  conversation_config: {
    agent: {
      first_message: string;
      language: string;
      dynamic_variables?: { dynamic_variable_placeholders: Record<string, string> };
      prompt: { prompt: string; llm: string; tools: ClientTool[]; built_in_tools: { skip_turn: SystemTool } };
    };
    tts: { voice_id: string; model_id: string; expressive_mode: boolean };
  };
  platform_settings: {
    overrides: {
      conversation_config_override: {
        agent: { prompt: { prompt: boolean }; first_message: boolean; language: boolean };
        tts: { speed: boolean; stability: boolean };
      };
    };
    auth: { enable_auth: boolean };
  };
};

// Wait for response on (VOICE_SETUP.md section 3) maps to expects_response.
function clientTool(
  name: string,
  description: string,
  properties: Record<string, LiteralProp>,
  required: string[],
): ClientTool {
  return {
    type: "client",
    name,
    description,
    expects_response: true,
    response_timeout_secs: 20,
    parameters: { type: "object", required, properties },
  };
}

export const INTERVIEWER_TOOLS: ClientTool[] = [
  clientTool(
    "set_off_record",
    'Pause or resume recording when the expert says "off the record" or "back on the record".',
    { active: { type: "boolean", description: "true to pause, false to resume." } },
    ["active"],
  ),
  clientTool(
    "confirm_teach_back",
    "Report whether the expert confirmed the teach-back summary.",
    {
      confirmed: { type: "boolean", description: "true if the expert confirmed the summary." },
      correction: { type: "string", description: "The expert's correction in their own words." },
    },
    ["confirmed"],
  ),
];

export const TUTOR_TOOLS: ClientTool[] = [
  clientTool(
    "replay_moment",
    "Show the learner the original screen moment for a step.",
    { step_n: { type: "number", description: "The Work Map step number." } },
    ["step_n"],
  ),
];

// Placeholders are used only when the app does not send dynamic variables at session start.
export const TUTOR_DYNAMIC_VARIABLES: Record<string, string> = {
  expert: "the expert",
  work_map: "(no Work Map loaded yet)",
};

function body(input: {
  name: string;
  voiceId: string;
  prompt: string;
  firstMessage: string;
  tools: ClientTool[];
  dynamicVariables?: Record<string, string>;
  opts: BuildOptions;
}): AgentCreateBody {
  return {
    name: input.name,
    conversation_config: {
      agent: {
        first_message: input.firstMessage,
        language: "en",
        ...(input.dynamicVariables
          ? { dynamic_variables: { dynamic_variable_placeholders: { ...input.dynamicVariables } } }
          : {}),
        prompt: {
          prompt: input.prompt,
          llm: input.opts.llm || DEFAULT_LLM,
          tools: input.tools,
          built_in_tools: { skip_turn: { ...SKIP_TURN_TOOL, params: { ...SKIP_TURN_TOOL.params } } },
        },
      },
      tts: {
        voice_id: input.voiceId,
        model_id: input.opts.ttsModel || DEFAULT_TTS_MODEL,
        expressive_mode: true,
      },
    },
    platform_settings: {
      overrides: {
        conversation_config_override: {
          agent: { prompt: { prompt: true }, first_message: true, language: true },
          // Agent Settings voice preset and speed (src/lib/agents/settings.ts voiceOverrides).
          tts: { speed: true, stability: true },
        },
      },
      // Signed URLs from /api/voice/signed-url keep working with auth on.
      auth: { enable_auth: true },
    },
  };
}

export function buildAgentBodies(
  prompts: AgentPrompts,
  opts: BuildOptions = {},
): { interviewer: AgentCreateBody; tutor: AgentCreateBody } {
  return {
    interviewer: body({
      name: INTERVIEWER_NAME,
      voiceId: INTERVIEWER_VOICE_ID,
      prompt: prompts.INTERVIEWER_PROMPT,
      firstMessage: prompts.INTERVIEWER_FIRST_MESSAGE,
      tools: INTERVIEWER_TOOLS,
      opts,
    }),
    tutor: body({
      name: TUTOR_NAME,
      voiceId: TUTOR_VOICE_ID,
      prompt: prompts.TUTOR_PROMPT,
      firstMessage: prompts.TUTOR_FIRST_MESSAGE,
      tools: TUTOR_TOOLS,
      dynamicVariables: TUTOR_DYNAMIC_VARIABLES,
      opts,
    }),
  };
}

/** PATCH /v1/convai/agents/{agent_id} body for an existing agent: the create body's config, name kept as is. */
export type AgentPatchBody = Pick<AgentCreateBody, "conversation_config" | "platform_settings">;

export function agentPatchBody(create: AgentCreateBody): AgentPatchBody {
  return { conversation_config: create.conversation_config, platform_settings: create.platform_settings };
}
