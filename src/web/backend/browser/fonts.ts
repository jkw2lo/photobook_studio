// URLs of the bundled .woff font files (the PDF embeds the same fonts the editor shows), keyed by
// the path core's fontFilePath() returns. Vite copies them into the build; they load on demand.

const files = import.meta.glob('../../../../node_modules/@fontsource/*/files/*-latin-[1-9]00-{normal,italic}.woff', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export const FONT_URLS = new Map(Object.entries(files).map(([k, url]) => [k.slice(k.indexOf('node_modules/')), url]));

const cache = new Map<string, Promise<Uint8Array>>();

export function fontBytes(file: string): Promise<Uint8Array> {
  let p = cache.get(file);
  if (!p) {
    const url = FONT_URLS.get(file);
    if (!url) return Promise.reject(new Error(`Font file not bundled: ${file}`));
    p = fetch(url).then(async (r) => {
      if (!r.ok) throw new Error(`Could not load the font ${file.split('/').pop()}`);
      return new Uint8Array(await r.arrayBuffer());
    });
    p.catch(() => cache.delete(file));
    cache.set(file, p);
  }
  return p;
}
