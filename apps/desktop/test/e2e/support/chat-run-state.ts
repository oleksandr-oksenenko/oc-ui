/// <reference types="node" />

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { Schema } from "effect";

export const CHAT_PROMPT =
  "Do not use tools. Reply with exactly this text on one line:\nOCUI_E2E_CHAT_SENTINEL";
export const CHAT_SENTINEL = "OCUI_E2E_CHAT_SENTINEL";

export type ChatRunState = {
  readonly sessionTitle: string;
  readonly sessionID: string;
  readonly userMessageID: string;
  readonly assistantMessageID: string;
  readonly fixtureDirectory: string;
};

export type ChatRunConfig = {
  readonly userDataPath: string;
  readonly chatStatePath: string;
  readonly fixtureDirectory: string;
  readonly providerID: string;
  readonly modelID: string;
  readonly agentID: string;
  readonly acceptanceCostCeilingUSD: number;
  readonly variant?: string;
};

function requiredEnv(name: string): string {
  const value = globalThis.process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} must be set`);
  return value;
}

function absoluteEnv(name: string): string {
  const value = requiredEnv(name);
  if (!isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  return value;
}

const config: ChatRunConfig = (() => {
  const userDataPath = absoluteEnv("OCUI_E2E_USER_DATA_PATH");
  const fixtureDirectory = absoluteEnv("OCUI_E2E_FIXTURE_DIRECTORY");
  const costCeilingText = requiredEnv("OCUI_E2E_CHAT_COST_CEILING_USD");
  const acceptanceCostCeilingUSD = Number(costCeilingText);
  if (!Number.isFinite(acceptanceCostCeilingUSD) || acceptanceCostCeilingUSD < 0) {
    throw new Error("OCUI_E2E_CHAT_COST_CEILING_USD must be a finite non-negative number");
  }
  const variant = globalThis.process.env.OCUI_E2E_CHAT_VARIANT;
  return {
    userDataPath,
    chatStatePath: absoluteEnv("OCUI_E2E_CHAT_STATE_PATH"),
    fixtureDirectory,
    providerID: requiredEnv("OCUI_E2E_CHAT_PROVIDER_ID"),
    modelID: requiredEnv("OCUI_E2E_CHAT_MODEL_ID"),
    agentID: requiredEnv("OCUI_E2E_CHAT_AGENT_ID"),
    acceptanceCostCeilingUSD,
    variant: variant && variant.length > 0 ? variant : undefined,
  };
})();

export function chatRunConfig(): ChatRunConfig {
  return config;
}

const ChatRunStateSchema = Schema.Struct({
  sessionTitle: Schema.NonEmptyString,
  sessionID: Schema.NonEmptyString,
  userMessageID: Schema.NonEmptyString,
  assistantMessageID: Schema.NonEmptyString,
  fixtureDirectory: Schema.NonEmptyString,
});
const parseChatRunState = Schema.decodeUnknownSync(ChatRunStateSchema, {
  onExcessProperty: "error",
});

function validateState(state: ChatRunState): ChatRunState {
  if (!isAbsolute(state.fixtureDirectory)) throw new Error("Invalid chat run state");
  return state;
}

export async function readChatRunState(path: string): Promise<ChatRunState> {
  return validateState(parseChatRunState(JSON.parse(await readFile(path, "utf8"))));
}

export async function writeChatRunState(path: string, state: ChatRunState): Promise<void> {
  const value = validateState(parseChatRunState(state));
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
}
