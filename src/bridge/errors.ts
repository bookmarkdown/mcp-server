export type BridgeErrorCode =
  | 'BRIDGE_UNAVAILABLE'
  | 'EXTENSION_NOT_CONNECTED'
  | 'UNSUPPORTED_OPERATION'
  | 'REQUEST_TIMEOUT'
  | 'EXTENSION_DISCONNECTED'
  | 'EXTENSION_OPERATION_FAILED'
  | 'REQUEST_CANCELLED'
  | 'BRIDGE_BUSY'
  | 'INVALID_EXTENSION_RESPONSE'
  | 'INTERNAL_ERROR';

const safeMessages: Record<BridgeErrorCode, string> = {
  BRIDGE_UNAVAILABLE: 'The local WebSocket bridge is unavailable.',
  EXTENSION_NOT_CONNECTED: 'No authenticated extension instance is available.',
  UNSUPPORTED_OPERATION: 'The extension does not support the requested browser operation.',
  REQUEST_TIMEOUT: 'The extension did not answer before the request timed out.',
  EXTENSION_DISCONNECTED: 'The extension disconnected before the request completed.',
  EXTENSION_OPERATION_FAILED: 'The extension reported that the operation failed.',
  REQUEST_CANCELLED: 'The MCP request was cancelled.',
  BRIDGE_BUSY: 'The bridge has reached its in-flight request limit.',
  INVALID_EXTENSION_RESPONSE: 'The extension returned an invalid response.',
  INTERNAL_ERROR: 'The bridge could not complete the request.',
};

export class BridgeError extends Error {
  public constructor(
    public readonly code: BridgeErrorCode,
    message: string = safeMessages[code],
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

export function asBridgeError(error: unknown): BridgeError {
  return error instanceof BridgeError ? error : new BridgeError('INTERNAL_ERROR');
}