import packageJson from '../package.json' with { type: 'json' };

// Set by the build script (`<commit>` or `<commit>-dirty`) so a bundled copy can tell which source it came from.
declare const __BUILD__: string | undefined;

export const VERSION: string = packageJson.version;

export function versionText(): string {
  const build = typeof __BUILD__ === 'string' && __BUILD__ !== '' ? `+${__BUILD__}` : '';
  return `pr-comments ${VERSION}${build}`;
}
