/**
 * Sealed story data (tools/story_seal.py writes it): base64 of zlib-compressed JSON XORed with a key stream, so the
 * Episode One choice data is not readable plain text in the repo or the built game. Obfuscation against spoilers on a
 * plain look, not secrecy. Works in the browser and under Node (both have crypto.subtle and DecompressionStream).
 *
 *   const data = await unseal(text)   // text = the .sealed file's contents (e.g. import x from './episode1.sealed?raw')
 */
const MAGIC = 'BSSEAL1';
const SEED = new TextEncoder().encode('beyond-sagittarius/episode-one');

async function stream(n: number): Promise<Uint8Array> {
  const out = new Uint8Array(Math.ceil(n / 32) * 32);
  for (let i = 0; i * 32 < n; i++) {
    const block = new Uint8Array(SEED.length + 4);
    block.set(SEED); new DataView(block.buffer).setUint32(SEED.length, i);
    out.set(new Uint8Array(await crypto.subtle.digest('SHA-256', block)), i * 32);
  }
  return out.subarray(0, n);
}

export async function unseal<T = unknown>(text: string): Promise<T> {
  const lines = text.split(/\s+/).filter(Boolean);
  if (lines[0] !== MAGIC) throw new Error('not a sealed file');
  const bin = atob(lines.slice(1).join(''));
  const x = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) x[i] = bin.charCodeAt(i);
  const k = await stream(x.length);
  for (let i = 0; i < x.length; i++) x[i] ^= k[i];
  const plain = new Blob([x]).stream().pipeThrough(new DecompressionStream('deflate'));
  return JSON.parse(await new Response(plain).text()) as T;
}
