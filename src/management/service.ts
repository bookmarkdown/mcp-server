import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { isLoopback } from '../network.js';
import { editableSettingsSchema, type SettingsStore } from '../settings.js';
import { managementCss, managementHtml, managementIcon, managementJs } from './page.js';

const secretRequest = z.strictObject({ which: z.enum(['mcpToken', 'bridgeToken']) });
export class ManagementService {
  readonly #csrf = randomBytes(32).toString('hex');
  readonly #initial: string;
  public constructor(private readonly store: SettingsStore, private readonly port: number,
    private readonly secrets: { mcpToken: string; bridgeToken: string },
    private readonly status: () => Record<string, unknown>) {
    this.#initial = JSON.stringify(store.settings);
  }
  public async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const hosts = [`127.0.0.1:${this.port}`, `localhost:${this.port}`];
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (!isLoopback(req.socket.remoteAddress) || !hosts.includes(req.headers.host ?? '') ||
      (req.headers.origin !== undefined && req.headers.origin !== `http://${req.headers.host}`)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end(
        `設定頁僅限本機存取。請在啟動 server 的電腦開啟：http://127.0.0.1:${this.port}/\n區網裝置請使用 MCP HTTP 或 WebSocket 端點連線。\n`,
      ); return;
    }
    const json = (status: number, value: unknown) => res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(value));
    if (req.method === 'GET') {
      const assets: Record<string, [string, string]> = {
        '/': ['text/html', managementHtml(this.#csrf)],
        '/assets/style.css': ['text/css', managementCss], '/assets/app.js': ['text/javascript', managementJs],
        '/assets/icon.svg': ['image/svg+xml', managementIcon],
      };
      const asset = assets[req.url ?? ''];
      if (asset) { res.writeHead(200, { 'Content-Type': `${asset[0]}; charset=utf-8` }).end(asset[1]); return; }
      if (req.url === '/api/status') {
        const { mcpToken: _mcp, bridgeToken: _bridge, version: _version, ...settings } = this.store.settings;
        json(200, { ...this.status(), settings, configPath: this.store.path, overrides: this.store.overrides,
          restartRequired: this.#initial !== JSON.stringify(this.store.settings) }); return;
      }
      json(404, { error: 'Not found.' }); return;
    }
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'GET, POST' }).end(); return; }
    const csrf = Buffer.from(typeof req.headers['x-csrf-token'] === 'string' ? req.headers['x-csrf-token'] : '');
    const expected = Buffer.from(this.#csrf);
    if (req.headers.origin !== `http://${req.headers.host}` || csrf.length !== expected.length || !timingSafeEqual(csrf, expected)) {
      json(403, { error: 'Invalid management request.' }); return;
    }
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) { json(415, { error: 'JSON required.' }); return; }
    try {
      const raw = await readBody(req);
      if (req.url === '/api/settings') { await this.store.save(editableSettingsSchema.parse(raw)); json(200, { ok: true }); return; }
      if (req.url === '/api/secrets' || req.url === '/api/rotate') {
        const { which } = secretRequest.parse(raw);
        if (req.url === '/api/secrets') json(200, { token: this.secrets[which] });
        else { await this.store.rotate(which); json(200, { ok: true }); }
        return;
      }
      json(404, { error: 'Not found.' });
    } catch { json(400, { error: 'Could not apply settings. Check values, ENV overrides, and file permissions.' }); }
  }
}
async function readBody(req: IncomingMessage): Promise<unknown> {
  if (Number(req.headers['content-length'] ?? 0) > 16384) throw new Error('Body too large.');
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk as Uint8Array); length += bytes.length;
    if (length > 16384) throw new Error('Body too large.');
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
