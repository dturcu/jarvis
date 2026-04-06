import {
  callGatewayTool,
} from "openclaw/plugin-sdk/browser-support";
import type { OpenClawConfig } from "openclaw/plugin-sdk/plugin-entry";

export type GatewayCallOptions = {
  gatewayUrl?: string;
  gatewayToken?: string;
  timeoutMs?: number;
};

export type ResolvedGatewayCallOptions = Required<GatewayCallOptions>;

function resolveGatewayPort(config?: OpenClawConfig): number {
  const fromConfig = config?.gateway?.port;
  if (typeof fromConfig === "number" && Number.isFinite(fromConfig)) {
    return fromConfig;
  }

  const fromEnv = Number(process.env.JARVIS_GATEWAY_PORT ?? "18789");
  return Number.isFinite(fromEnv) ? fromEnv : 18789;
}

export function resolveGatewayCallOptions(
  config?: OpenClawConfig,
  overrides: GatewayCallOptions = {},
): ResolvedGatewayCallOptions {
  const port = resolveGatewayPort(config);
  const auth = config?.gateway?.auth;
  const tokenFromConfig =
    auth?.mode === "token" && typeof auth.token === "string"
      ? auth.token
      : undefined;
  const gatewayUrl =
    overrides.gatewayUrl ??
    process.env.JARVIS_GATEWAY_URL ??
    `ws://127.0.0.1:${port}`;
  const gatewayToken =
    overrides.gatewayToken ??
    process.env.JARVIS_GATEWAY_TOKEN ??
    tokenFromConfig ??
    "";

  return {
    gatewayUrl,
    gatewayToken,
    timeoutMs: overrides.timeoutMs ?? 30000
  };
}

export async function invokeGatewayMethod<T = Record<string, unknown>>(
  method: string,
  config?: OpenClawConfig,
  params?: unknown,
  overrides: GatewayCallOptions = {},
): Promise<T> {
  const options = resolveGatewayCallOptions(config, overrides);
  return callGatewayTool<T>(method, options, params);
}

export async function sendSessionMessage(
  params: {
    sessionKey: string;
    message: string;
    timeoutMs?: number;
    idempotencyKey?: string;
  },
  config?: OpenClawConfig,
  overrides: GatewayCallOptions = {},
): Promise<Record<string, unknown>> {
  return invokeGatewayMethod(
    "sessions.send",
    config,
    {
      key: params.sessionKey,
      message: params.message,
      timeoutMs: params.timeoutMs,
      idempotencyKey: params.idempotencyKey
    },
    overrides,
  );
}
