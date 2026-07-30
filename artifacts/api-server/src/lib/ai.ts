import { chatComplete, type AIMessage as ProviderMessage, type ChatParams } from "./ai-providers";

export type AIMessage = ProviderMessage;

/**
 * OpenAI-shaped facade kept for backwards compatibility.
 * All calls are routed through the admin-managed multi-provider key pool
 * (Gemini, Groq, Mistral, OpenAI, OpenRouter…) with automatic rotation.
 */
export const aiClient = {
  chat: {
    completions: {
      create: (params: ChatParams) => chatComplete(params),
    },
  },
};

export const AI_MODEL = "auto";
export const AI_SUPPORTS_VISION = true;

export { chatComplete };
