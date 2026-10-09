import { createRequire } from 'node:module';

export const PACKAGE_VERSION: string = createRequire(import.meta.url)('../package.json').version;
