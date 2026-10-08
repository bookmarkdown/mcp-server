import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';

const token = z.string().min(32).max(512).regex(/^[\x21-\x7e]+$/);
export const editableSettingsSchema = z.strictObject({
  lanEnabled: z.boolean(),
  mcpPort: z.number().int().min(1).max(65535),
  webSocketPort: z.number().int().min(1).max(65535),
  requestTimeoutMs: z.number().int().min(100).max(60000),
  maxConnections: z.number().int().min(1).max(64),
  maxPendingRequests: z.number().int().min(1).max(256),
  extensionIds: z.array(z.string().regex(/^[a-p]{32}$/)).max(256),
}).refine((value) => value.mcpPort !== value.webSocketPort);
const settingsSchema = z.strictObject({
  version: z.literal(1), ...editableSettingsSchema.shape,
  mcpToken: token, bridgeToken: token,
}).refine((value) => value.mcpPort !== value.webSocketPort);
export type Settings = z.infer<typeof settingsSchema>;
export type EditableSettings = z.infer<typeof editableSettingsSchema>;
export const settingEnvironment = {
  lanEnabled: 'BOOKMARKDOWN_LAN_ENABLED', mcpPort: 'BOOKMARKDOWN_MCP_PORT',
  webSocketPort: 'BOOKMARKDOWN_WS_PORT', requestTimeoutMs: 'BOOKMARKDOWN_REQUEST_TIMEOUT_MS',
  maxConnections: 'BOOKMARKDOWN_MAX_CONNECTIONS', maxPendingRequests: 'BOOKMARKDOWN_MAX_PENDING_REQUESTS',
  extensionIds: 'BOOKMARKDOWN_EXTENSION_IDS', mcpToken: 'BOOKMARKDOWN_MCP_TOKEN', bridgeToken: 'BOOKMARKDOWN_BRIDGE_TOKEN',
} as const;

export function defaultSettingsPath(env: NodeJS.ProcessEnv, platform = process.platform): string {
  if (env.BOOKMARKDOWN_CONFIG_FILE) return resolve(env.BOOKMARKDOWN_CONFIG_FILE);
  if (platform === 'win32') return join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'BookMarkdown', 'mcp-server', 'config.json');
  if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'BookMarkdown', 'mcp-server', 'config.json');
  const root = env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(homedir(), '.config');
  return join(root, 'bookmarkdown-mcp', 'config.json');
}
function freshSettings(): Settings {
  return { version: 1, lanEnabled: false, mcpPort: 38472, webSocketPort: 38471,
    requestTimeoutMs: 5000, maxConnections: 8, maxPendingRequests: 32, extensionIds: [],
    mcpToken: randomBytes(32).toString('hex'), bridgeToken: randomBytes(32).toString('hex') };
}
function serialize(settings: Settings): string { return JSON.stringify(settings, null, 2) + '\n'; }
async function readSettings(path: string): Promise<Settings> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 16384) throw new Error('Invalid configuration file.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 16384) throw new Error('Invalid configuration file.');
    // Fixed-size read also bounds files that grow after stat.
    const bytes = Buffer.alloc(16385);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 16384) throw new Error('Invalid configuration file.');
    return settingsSchema.parse(JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')));
  } finally { await file.close(); }
}
export class SettingsStore {
  #settings: Settings;
  #writing = false;
  private constructor(public readonly path: string, settings: Settings, public readonly env: NodeJS.ProcessEnv) {
    this.#settings = settings;
  }
  public static async load(env: NodeJS.ProcessEnv = process.env): Promise<SettingsStore> {
    const path = defaultSettingsPath(env);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    try {
      const file = await open(path, 'wx', 0o600);
      try { await file.writeFile(serialize(freshSettings())); await file.sync(); } finally { await file.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new Error('Could not create configuration file. Check directory permissions.');
    }
    try { return new SettingsStore(path, await readSettings(path), { ...env }); }
    catch { throw new Error('Invalid or unreadable configuration file. Fix it before starting; it was not overwritten.'); }
  }
  public get settings(): Settings { return structuredClone(this.#settings); }
  public get overrides(): string[] {
    return Object.entries(settingEnvironment).filter(([, name]) => this.env[name] !== undefined).map(([key]) => key);
  }
  public effectiveEnv(): NodeJS.ProcessEnv {
    const result = { ...this.env };
    for (const [key, name] of Object.entries(settingEnvironment)) {
      const value = this.#settings[key as keyof typeof settingEnvironment];
      if (result[name] === undefined) result[name] = Array.isArray(value) ? value.join(',') : String(value);
    }
    return result;
  }
  public async save(values: EditableSettings): Promise<void> {
    const parsed = editableSettingsSchema.parse(values);
    for (const key of this.overrides) {
      if (key in parsed && JSON.stringify(parsed[key as keyof EditableSettings]) !== JSON.stringify(this.#settings[key as keyof Settings]))
        throw new Error('An environment override makes this setting read-only.');
    }
    await this.#write(settingsSchema.parse({ ...this.#settings, ...parsed }));
  }
  public async rotate(which: 'mcpToken' | 'bridgeToken'): Promise<void> {
    if (this.overrides.includes(which)) throw new Error('Token is overridden by the environment.');
    await this.#write({ ...this.#settings, [which]: randomBytes(32).toString('hex') });
  }
  async #write(settings: Settings): Promise<void> {
    settings = settingsSchema.parse(settings);
    if (this.#writing) throw new Error('Another configuration update is in progress.');
    this.#writing = true;
    const temporary = `${this.path}.${randomBytes(12).toString('hex')}.tmp`;
    try {
      await readSettings(this.path);
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(serialize(settings)); await file.sync(); } finally { await file.close(); }
      await rename(temporary, this.path);
      this.#settings = settings;
    } finally {
      await unlink(temporary).catch(() => {});
      this.#writing = false;
    }
  }
}
