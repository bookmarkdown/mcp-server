import { Buffer } from 'node:buffer';
import { TextDecoder } from 'node:util';

export const IPC_FRAME_HEADER_BYTES = 4;
export const DEFAULT_IPC_MAX_PAYLOAD_BYTES = 64 * 1024;
export const MAX_IPC_PAYLOAD_BYTES = 1024 * 1024;

export type IpcFrameErrorCode =
  | 'INVALID_FRAME_LENGTH'
  | 'FRAME_TOO_LARGE'
  | 'INVALID_UTF8'
  | 'INVALID_JSON'
  | 'TRUNCATED_FRAME';

export class IpcFrameError extends Error {
  public constructor(
    public readonly code: IpcFrameErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'IpcFrameError';
  }
}

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

export function encodeIpcFrame(
  message: unknown,
  maxPayloadBytes = DEFAULT_IPC_MAX_PAYLOAD_BYTES,
): Buffer {
  validateMaxPayloadBytes(maxPayloadBytes);

  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(message);
  } catch {
    throw new TypeError('IPC message must be JSON-serializable.');
  }

  if (serialized === undefined) {
    throw new TypeError('IPC message must be JSON-serializable.');
  }

  const payloadLength = Buffer.byteLength(serialized, 'utf8');
  if (payloadLength > maxPayloadBytes) {
    throw new IpcFrameError(
      'FRAME_TOO_LARGE',
      'IPC frame exceeds the configured payload limit.',
    );
  }

  const payload = Buffer.from(serialized, 'utf8');
  const frame = Buffer.allocUnsafe(IPC_FRAME_HEADER_BYTES + payloadLength);
  frame.writeUInt32BE(payloadLength, 0);
  payload.copy(frame, IPC_FRAME_HEADER_BYTES);
  return frame;
}

export class IpcFrameDecoder {
  readonly #maxPayloadBytes: number;
  readonly #header = Buffer.alloc(IPC_FRAME_HEADER_BYTES);
  #headerBytesRead = 0;
  #payloadLength: number | undefined;
  #payload: Buffer | undefined;
  #payloadBytesRead = 0;
  #closed = false;

  public constructor(maxPayloadBytes = DEFAULT_IPC_MAX_PAYLOAD_BYTES) {
    validateMaxPayloadBytes(maxPayloadBytes);
    this.#maxPayloadBytes = maxPayloadBytes;
  }

  public get bufferedBytes(): number {
    return (
      this.#headerBytesRead +
      (this.#payloadLength === undefined
        ? 0
        : IPC_FRAME_HEADER_BYTES + this.#payloadBytesRead)
    );
  }

  public push(chunk: Uint8Array): unknown[] {
    if (this.#closed) {
      throw new Error('IPC frame decoder is closed.');
    }

    const messages: unknown[] = [];
    let offset = 0;

    try {
      while (offset < chunk.byteLength) {
        if (this.#payloadLength === undefined) {
          const headerBytes = Math.min(
            IPC_FRAME_HEADER_BYTES - this.#headerBytesRead,
            chunk.byteLength - offset,
          );
          this.#header.set(
            chunk.subarray(offset, offset + headerBytes),
            this.#headerBytesRead,
          );
          this.#headerBytesRead += headerBytes;
          offset += headerBytes;

          if (this.#headerBytesRead < IPC_FRAME_HEADER_BYTES) {
            continue;
          }

          const payloadLength = this.#header.readUInt32BE(0);
          if (payloadLength === 0) {
            throw new IpcFrameError(
              'INVALID_FRAME_LENGTH',
              'IPC frame payload length must be greater than zero.',
            );
          }
          if (payloadLength > this.#maxPayloadBytes) {
            throw new IpcFrameError(
              'FRAME_TOO_LARGE',
              'IPC frame exceeds the configured payload limit.',
            );
          }

          this.#headerBytesRead = 0;
          this.#payloadLength = payloadLength;
          this.#payload = Buffer.allocUnsafe(payloadLength);
        }

        const payload = this.#payload;
        const payloadLength = this.#payloadLength;
        if (payload === undefined || payloadLength === undefined) {
          throw new Error('IPC frame decoder entered an invalid state.');
        }

        const payloadBytes = Math.min(
          payloadLength - this.#payloadBytesRead,
          chunk.byteLength - offset,
        );
        payload.set(
          chunk.subarray(offset, offset + payloadBytes),
          this.#payloadBytesRead,
        );
        this.#payloadBytesRead += payloadBytes;
        offset += payloadBytes;

        if (this.#payloadBytesRead === payloadLength) {
          this.#clearFrame();
          messages.push(decodeJsonPayload(payload));
        }
      }
    } catch (error) {
      this.#clearFrame();
      this.#closed = true;
      throw error;
    }

    return messages;
  }

  public end(): void {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    if (this.bufferedBytes > 0) {
      this.#clearFrame();
      throw new IpcFrameError(
        'TRUNCATED_FRAME',
        'IPC stream ended before the frame was complete.',
      );
    }
  }

  #clearFrame(): void {
    this.#headerBytesRead = 0;
    this.#payloadLength = undefined;
    this.#payload = undefined;
    this.#payloadBytesRead = 0;
  }
}

function decodeJsonPayload(payload: Buffer): unknown {
  let serialized: string;
  try {
    serialized = utf8Decoder.decode(payload);
  } catch {
    throw new IpcFrameError(
      'INVALID_UTF8',
      'IPC frame payload is not valid UTF-8.',
    );
  }

  try {
    return JSON.parse(serialized) as unknown;
  } catch {
    throw new IpcFrameError(
      'INVALID_JSON',
      'IPC frame payload is not valid JSON.',
    );
  }
}

function validateMaxPayloadBytes(maxPayloadBytes: number): void {
  if (
    !Number.isSafeInteger(maxPayloadBytes) ||
    maxPayloadBytes < 1 ||
    maxPayloadBytes > MAX_IPC_PAYLOAD_BYTES
  ) {
    throw new RangeError(
      `IPC payload limit must be an integer between 1 and ${MAX_IPC_PAYLOAD_BYTES} bytes.`,
    );
  }
}