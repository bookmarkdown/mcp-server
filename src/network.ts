import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
export function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
export function privateAddresses(): string[] {
  return [...new Set(Object.values(networkInterfaces()).flatMap((items) =>
    (items ?? []).filter((item) => item.family === 'IPv4' && isPrivateAddress(item.address)).map((item) => item.address)))];
}
export function allowedHosts(host: string, port: number): string[] {
  const addresses = host === '0.0.0.0' ? ['127.0.0.1', 'localhost', ...privateAddresses()]
    : host === '127.0.0.1' ? ['127.0.0.1', 'localhost'] : [host];
  return addresses.map((address) => `${address}:${port}`);
}
export function allowedPeer(address: string | undefined): boolean {
  return isLoopback(address) || isPrivateAddress((address ?? '').replace(/^::ffff:/, ''));
}
export function lanEnabled(env: NodeJS.ProcessEnv): boolean {
  const value = env.BOOKMARKDOWN_LAN_ENABLED ?? 'false';
  if (!['true', 'false', '1', '0'].includes(value)) throw new Error('BOOKMARKDOWN_LAN_ENABLED must be true or false.');
  return value === 'true' || value === '1';
}
