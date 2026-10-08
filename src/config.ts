import { isIP } from 'node:net';
import { lanEnabled } from './network.js';

export type RuntimeMode = 'development' | 'production';

export interface BridgeConfig {
  runtimeMode: RuntimeMode;
  host: string;
  port: number;
  tlsCertFile?: string;
  tlsKeyFile?: string;
  token: string;
  extensionIds: string[];
  maxPayloadBytes: number;
  maxPendingRequests: number;
  maxConnections: number;
  maxRegisteredInstances: number;
  requestTimeoutMs: number;
  helloTimeoutMs: number;
}

export type BridgeConfigResult =
  | { ok: true; config: BridgeConfig }
  | { ok: false; reason: string };

const defaults = {
  host: '127.0.0.1',
  port: 38471,
  maxPayloadBytes: 64 * 1024,
  maxPendingRequests: 32,
  maxConnections: 8,
  maxRegisteredInstances: 64,
  requestTimeoutMs: 5000,
  helloTimeoutMs: 5000,
} as const;

function parseBoundedInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number | string {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    return `${name} must be an integer between ${minimum} and ${maximum}.`;
  }

  return value;
}

export function parseBridgeConfig(
  env: NodeJS.ProcessEnv,
  runtimeMode: RuntimeMode = 'production',
): BridgeConfigResult {
  if (runtimeMode !== 'production' && runtimeMode !== 'development') {
    return { ok: false, reason: 'Runtime mode must be production or development.' };
  }

  let lan: boolean;
  try { lan = lanEnabled(env); } catch (error) { return { ok: false, reason: (error as Error).message }; }
  const host = env.BOOKMARKDOWN_WS_HOST ?? (lan ? '0.0.0.0' : defaults.host);
  if (host !== defaults.host && !(lan && host === '0.0.0.0') && !isPrivateIpv4Address(host)) {
    return {
      ok: false,
      reason: 'BOOKMARKDOWN_WS_HOST must be 127.0.0.1, a private RFC1918 IPv4 address, or 0.0.0.0 with LAN enabled.',
    };
  }

  const tlsCertFile = env.BOOKMARKDOWN_WS_TLS_CERT_FILE?.trim();
  const tlsKeyFile = env.BOOKMARKDOWN_WS_TLS_KEY_FILE?.trim();
  if (Boolean(tlsCertFile) !== Boolean(tlsKeyFile)) {
    return {
      ok: false,
      reason: 'BOOKMARKDOWN_WS_TLS_CERT_FILE and BOOKMARKDOWN_WS_TLS_KEY_FILE must be configured together.',
    };
  }

  const token = env.BOOKMARKDOWN_BRIDGE_TOKEN;
  if (token === undefined || token.length === 0) {
    return {
      ok: false,
      reason: 'BOOKMARKDOWN_BRIDGE_TOKEN is required to enable the WebSocket bridge.',
    };
  }

  const tokenLength = Buffer.byteLength(token, 'utf8');
  if (tokenLength < 32 || tokenLength > 512) {
    return {
      ok: false,
      reason: 'BOOKMARKDOWN_BRIDGE_TOKEN must contain between 32 and 512 UTF-8 bytes.',
    };
  }

  let extensionIds: string[] = [];
  if (runtimeMode === 'production') {
    extensionIds = (env.BOOKMARKDOWN_EXTENSION_IDS ?? '')
      .split(',')
      .map((extensionId) => extensionId.trim())
      .filter(Boolean);

    if (extensionIds.some((extensionId) => !/^[a-p]{32}$/.test(extensionId))) {
      return {
        ok: false,
        reason: 'BOOKMARKDOWN_EXTENSION_IDS contains an invalid Chrome extension ID.',
      };
    }
  }

  const port = parseBoundedInteger(
    env.BOOKMARKDOWN_WS_PORT,
    defaults.port,
    1,
    65535,
    'BOOKMARKDOWN_WS_PORT',
  );
  const maxPayloadBytes = parseBoundedInteger(
    env.BOOKMARKDOWN_MAX_PAYLOAD_BYTES,
    defaults.maxPayloadBytes,
    1024,
    1024 * 1024,
    'BOOKMARKDOWN_MAX_PAYLOAD_BYTES',
  );
  const maxPendingRequests = parseBoundedInteger(
    env.BOOKMARKDOWN_MAX_PENDING_REQUESTS,
    defaults.maxPendingRequests,
    1,
    256,
    'BOOKMARKDOWN_MAX_PENDING_REQUESTS',
  );
  const maxConnections = parseBoundedInteger(
    env.BOOKMARKDOWN_MAX_CONNECTIONS,
    defaults.maxConnections,
    1,
    64,
    'BOOKMARKDOWN_MAX_CONNECTIONS',
  );
  const maxRegisteredInstances = parseBoundedInteger(
    env.BOOKMARKDOWN_MAX_REGISTERED_INSTANCES,
    defaults.maxRegisteredInstances,
    1,
    256,
    'BOOKMARKDOWN_MAX_REGISTERED_INSTANCES',
  );
  const requestTimeoutMs = parseBoundedInteger(
    env.BOOKMARKDOWN_REQUEST_TIMEOUT_MS,
    defaults.requestTimeoutMs,
    100,
    60000,
    'BOOKMARKDOWN_REQUEST_TIMEOUT_MS',
  );
  const helloTimeoutMs = parseBoundedInteger(
    env.BOOKMARKDOWN_HELLO_TIMEOUT_MS,
    defaults.helloTimeoutMs,
    250,
    30000,
    'BOOKMARKDOWN_HELLO_TIMEOUT_MS',
  );

  const numericValues = [
    port,
    maxPayloadBytes,
    maxPendingRequests,
    maxConnections,
    maxRegisteredInstances,
    requestTimeoutMs,
    helloTimeoutMs,
  ];
  const invalidValue = numericValues.find((value) => typeof value === 'string');
  if (typeof invalidValue === 'string') {
    return { ok: false, reason: invalidValue };
  }

  return {
    ok: true,
    config: {
      runtimeMode,
      host,
      port: port as number,
      ...(tlsCertFile && tlsKeyFile ? { tlsCertFile, tlsKeyFile } : {}),
      token,
      extensionIds: [...new Set(extensionIds)],
      maxPayloadBytes: maxPayloadBytes as number,
      maxPendingRequests: maxPendingRequests as number,
      maxConnections: maxConnections as number,
      maxRegisteredInstances: maxRegisteredInstances as number,
      requestTimeoutMs: requestTimeoutMs as number,
      helloTimeoutMs: helloTimeoutMs as number,
    },
  };
}

function isPrivateIpv4Address(address: string): boolean {
  if (isIP(address) !== 4) {
    return false;
  }
  const octets = address.split('.').map(Number);
  const [firstOctet, secondOctet] = octets;
  return firstOctet === 10 ||
    (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31) ||
    (firstOctet === 192 && secondOctet === 168);
}

export const defaultBridgeLimits = {
  maxPayloadBytes: defaults.maxPayloadBytes,
  maxPendingRequests: defaults.maxPendingRequests,
  requestTimeoutMs: defaults.requestTimeoutMs,
} as const;
