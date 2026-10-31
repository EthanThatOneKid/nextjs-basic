// src/index.ts — public API

import { BasicPlugin } from './plugin';

export { callBasic, shutdownAll } from './runtime/basicRuntime';
export type { BasicPayload } from './runtime/basicRuntime';
export { BasicPlugin };

// next.config.js helper
export function withBasic(nextConfig: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...nextConfig,
    webpack(
      config: { plugins: unknown[] },
      options: { dir?: string; isServer?: boolean }
    ) {
      config.plugins.push(new BasicPlugin(options));

      // Preserve the user's own webpack customisation
      if (typeof (nextConfig as { webpack?: Function }).webpack === 'function') {
        return (nextConfig as { webpack: Function }).webpack(config, options);
      }
      return config;
    },
  };
}
