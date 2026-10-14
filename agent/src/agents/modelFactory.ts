import type { AgentConfig } from "../config.js";
import { AnthropicModel, GroqModel, type AgentModel } from "./model.js";

/** The provider named by MODEL_PROVIDER. There is no fallback between providers: the chosen one works or the agent fails closed. */
export function createModel(cfg: AgentConfig): AgentModel {
  return cfg.MODEL_PROVIDER === "groq"
    ? new GroqModel({ apiKey: cfg.GROQ_API_KEY ?? "", model: cfg.GROQ_MODEL })
    : new AnthropicModel({ apiKey: cfg.ANTHROPIC_API_KEY ?? "", model: cfg.ANTHROPIC_MODEL });
}

export const modelKeyOf = (cfg: AgentConfig): string | undefined => (cfg.MODEL_PROVIDER === "groq" ? cfg.GROQ_API_KEY : cfg.ANTHROPIC_API_KEY);
export const modelNameOf = (cfg: AgentConfig): string => (cfg.MODEL_PROVIDER === "groq" ? cfg.GROQ_MODEL : cfg.ANTHROPIC_MODEL);
