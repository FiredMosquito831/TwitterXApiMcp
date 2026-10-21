import { parseHTML } from 'linkedom';
import { createHash } from 'node:crypto';

/**
 * Port of the public x-client-transaction-id reconstruction (MIT, Lqm1 /
 * iSarabjitDhiman). X rotates the bundle layout regularly; every step below has
 * a fallback and the caller may proceed without a transaction id for operations
 * that do not enforce it.
 */

const ON_DEMAND_CHUNK_NAME = 'ondemand.s';
const INDICES_REGEX = /\(\w\[(\d{1,2})\],\s*16\)/g;
const ON_DEMAND_FILE_HASH_REGEX =
  /(\d+):\s*["']ondemand\.s["'][\s\S]*?\}\)\[e\]\s*\|\|\s*e\)\s*\+\s*["']\.["']\s*\+\s*\(\{[\s\S]*?\b\1:\s*["']([a-zA-Z0-9_-]+)["']/s;

const KEYWORD = 'obfiowerehiring';
const ADDITIONAL_RANDOM_NUMBER = 3;
const EPOCH_MS = 1682924400 * 1000;

type LinkedomDocument = ReturnType<typeof parseHTML>['document'];

interface MiniElement {
  getAttribute(name: string): string | null;
  querySelectorAll(selector: string): ArrayLike<MiniElement>;
  readonly children: ArrayLike<MiniElement>;
}

class Cubic {
  readonly #curves: number[];

  constructor(curves: number[]) {
    this.#curves = curves;
  }

  getValue(time: number): number {
    const curves = this.#curves;
    let startGradient = 0;
    let endGradient = 0;
    let start = 0;
    let mid = 0;
    let end = 1;

    if (time <= 0) {
      if ((curves[0] ?? 0) > 0) {
        startGradient = (curves[1] ?? 0) / (curves[0] ?? 1);
      } else if (curves[1] === 0 && (curves[2] ?? 0) > 0) {
        startGradient = (curves[3] ?? 0) / (curves[2] ?? 1);
      }
      return startGradient * time;
    }

    if (time >= 1) {
      if ((curves[2] ?? 0) < 1) {
        endGradient = ((curves[3] ?? 0) - 1) / ((curves[2] ?? 0) - 1);
      } else if (curves[2] === 1 && (curves[0] ?? 0) < 1) {
        endGradient = ((curves[1] ?? 0) - 1) / ((curves[0] ?? 0) - 1);
      }
      return 1 + endGradient * (time - 1);
    }

    while (start < end) {
      mid = (start + end) / 2;
      const xEst = this.#calculate(curves[0] ?? 0, curves[2] ?? 0, mid);
      if (Math.abs(time - xEst) < 1e-6) {
        return this.#calculate(curves[1] ?? 0, curves[3] ?? 0, mid);
      }
      if (xEst < time) start = mid;
      else end = mid;
    }
    return this.#calculate(curves[1] ?? 0, curves[3] ?? 0, mid);
  }

  #calculate(a: number, b: number, m: number): number {
    return 3 * a * (1 - m) * (1 - m) * m + 3 * b * (1 - m) * m * m + m * m * m;
  }
}

function interpolate(from: number[], to: number[], f: number): number[] {
  return from.map((value, index) => value * (1 - f) + (to[index] ?? 0) * f);
}

function rotationMatrix(degrees: number): number[] {
  const rad = (degrees * Math.PI) / 180;
  return [Math.cos(rad), -Math.sin(rad), Math.sin(rad), Math.cos(rad)];
}

function floatToHex(input: number): string {
  const result: string[] = [];
  let x = input;
  let quotient = Math.floor(x);
  let fraction = x - quotient;

  while (quotient > 0) {
    quotient = Math.floor(x / 16);
    const remainder = Math.floor(x - quotient * 16);
    result.unshift(remainder > 9 ? String.fromCharCode(remainder + 55) : remainder.toString());
    x = quotient;
  }

  if (fraction === 0) return result.join('');

  result.push('.');
  while (fraction > 0) {
    fraction *= 16;
    const integer = Math.floor(fraction);
    fraction -= integer;
    result.push(integer > 9 ? String.fromCharCode(integer + 55) : integer.toString());
  }
  return result.join('');
}

function oddOffset(index: number): number {
  return index % 2 ? -1 : 0;
}

function solve(value: number, min: number, max: number, rounding: boolean): number {
  const result = (value * (max - min)) / 255 + min;
  return rounding ? Math.floor(result) : Math.round(result * 100) / 100;
}

function animate(frames: number[], targetTime: number): string {
  const fromColor = [...frames.slice(0, 3), 1];
  const toColor = [...frames.slice(3, 6), 1];
  const fromRotation = [0];
  const toRotation = [solve(frames[6] ?? 0, 60, 360, true)];

  const curves = frames
    .slice(7)
    .map((item, counter) => solve(item, oddOffset(counter), 1, false));

  const value = new Cubic(curves).getValue(targetTime);
  const color = interpolate(fromColor, toColor, value).map((v) => (v > 0 ? v : 0));
  const rotation = interpolate(fromRotation, toRotation, value);
  const matrix = rotationMatrix(rotation[0] ?? 0);

  const parts: string[] = color.slice(0, -1).map((v) => Math.round(v).toString(16));

  for (const raw of matrix) {
    let rounded = Math.round(raw * 100) / 100;
    if (rounded < 0) rounded = -rounded;
    const hex = floatToHex(rounded);
    parts.push(hex.startsWith('.') ? `0${hex}`.toLowerCase() : hex || '0');
  }

  parts.push('0', '0');
  return parts.join('').replace(/[.-]/g, '');
}

export interface TransactionMaterials {
  key: string;
  keyBytes: number[];
  rowIndex: number;
  keyByteIndices: number[];
  animationKey: string;
  frameCount: number;
  generatedAt: number;
}

export interface TransactionOptions {
  fetchImpl?: typeof fetch;
  userAgent?: string;
  cookieHeader?: string;
}

function scriptsFrom(html: string): string[] {
  const urls = new Set<string>();
  const regex = /https:\/\/abs\.twimg\.com\/[^"'\\\s]+?\.js/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) urls.add(match[0]);
  return [...urls];
}

function resolveOnDemandUrl(html: string, scripts: string[]): string | null {
  const hashMatch = ON_DEMAND_FILE_HASH_REGEX.exec(html);
  if (hashMatch?.[2]) {
    return `https://abs.twimg.com/responsive-web/client-web/${ON_DEMAND_CHUNK_NAME}.${hashMatch[2]}a.js`;
  }

  const direct = scripts.find((url) => /ondemand\.s[.-]/.test(url));
  if (direct) return direct;

  const sign = scripts.find((url) => /sign\.o[.-]/.test(url));
  if (sign) return sign;

  return null;
}

async function fetchText(
  url: string,
  opts: TransactionOptions,
): Promise<string | null> {
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, {
      headers: {
        'user-agent': opts.userAgent ?? CHROME_UA,
        accept: '*/*',
        ...(opts.cookieHeader ? { cookie: opts.cookieHeader } : {}),
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

/** Find the DOM structure X uses for the verification key and animation frames. */
export function extractMaterials(html: string, document: LinkedomDocument): {
  key: string;
  keyBytes: number[];
  framePaths: string[];
  rowIndexHint: number;
} {
  let key = '';
  const meta = document.querySelector("[name='twitter-site-verification']") as MiniElement | null;
  key = meta?.getAttribute('content') ?? '';
  if (!key) {
    const match = /name=["']twitter-site-verification["'][^>]*content=["']([^"']+)["']/.exec(html);
    if (match?.[1]) key = match[1];
  }
  if (!key) throw new Error('Could not find twitter-site-verification in the page');

  const keyBytes = [...Buffer.from(key, 'base64')];
  if (keyBytes.length < 6) throw new Error('Verification key is too short');

  const frameElements = Array.from(
    document.querySelectorAll("[id^='loading-x-anim']") as ArrayLike<MiniElement>,
  );
  const framePaths: string[] = [];

  if (frameElements.length) {
    for (const frame of frameElements) {
      const first = frame.children[0] as MiniElement | undefined;
      const target = first?.children[1] as MiniElement | undefined;
      const d = target?.getAttribute('d') ?? first?.getAttribute('d') ?? null;
      if (d) framePaths.push(d);
    }
  }

  if (!framePaths.length) {
    // 2026 build: server-rendered SVG frames without stable ids.
    const svgRegex = /<svg[^>]*>([\s\S]*?)<\/svg>/g;
    let svg: RegExpExecArray | null;
    while ((svg = svgRegex.exec(html)) !== null) {
      const body = svg[1] ?? '';
      if (!body.includes('C')) continue;
      const paths = [...body.matchAll(/<path[^>]*\sd="([^"]+)"/g)]
        .map((m) => m[1])
        .filter((d): d is string => typeof d === 'string' && /C/.test(d));
      if (paths.length) framePaths.push(paths[paths.length - 1] ?? paths[0] ?? '');
      if (framePaths.length >= 4) break;
    }
  }

  if (!framePaths.length) throw new Error('Could not find animation frames in the page');

  return {
    key,
    keyBytes,
    framePaths,
    rowIndexHint: keyBytes[5] ?? 0,
  };
}

/** Each `C` segment in the SVG path is one animation row. */
export function parseFramePath(path: string): number[][] {
  const items = path.substring(9).split('C');
  const rows: number[][] = [];
  for (const item of items) {
    const cleaned = item.replace(/[^\d]+/g, ' ').trim();
    if (!cleaned) continue;
    const row = cleaned
      .split(/\s+/)
      .map((part) => parseInt(part, 10))
      .filter((value) => !Number.isNaN(value));
    if (row.length) rows.push(row);
  }
  return rows;
}

/**
 * Build a transaction-id generator from a page's HTML.
 * Throws when the page is a logged-out x-web build without the required chunk.
 */
export async function createTransactionGenerator(
  html: string,
  opts: TransactionOptions = {},
): Promise<{ generate(method: string, path: string, timeNow?: number): string; materials: TransactionMaterials }> {
  const { document } = parseHTML(html) as unknown as { document: LinkedomDocument };
  const { key, keyBytes, framePaths, rowIndexHint } = extractMaterials(html, document);

  const scripts = scriptsFrom(html);
  const candidates: string[] = [];
  const onDemand = resolveOnDemandUrl(html, scripts);
  if (onDemand) candidates.push(onDemand);
  for (const url of scripts) {
    if (/ondemand\.s|sign\.o/.test(url)) candidates.push(url);
  }
  if (!candidates.length) candidates.push(...scripts.slice(0, 40));

  let indices: number[] = [];
  for (const url of [...new Set(candidates)]) {
    const text = await fetchText(url, opts);
    if (!text) continue;
    INDICES_REGEX.lastIndex = 0;
    const found: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = INDICES_REGEX.exec(text)) !== null) {
      found.push(parseInt(match[1] ?? '0', 10));
    }
    if (found.length >= 2) {
      indices = found;
      break;
    }
  }

  if (indices.length < 2) {
    throw new Error('Could not extract key-byte indices (X may have changed the bundle layout)');
  }

  const rowIndexFromIndices = indices[0] ?? rowIndexHint;
  const keyByteIndices = indices.slice(1);

  // X picks one of four SVG frames by key byte 5, then one row inside it by
  // the row-index byte extracted from the signing chunk.
  const selectedFrame = framePaths[(keyBytes[5] ?? 0) % 4] ?? framePaths[0];
  if (!selectedFrame) throw new Error('No animation frame available');
  const rows = parseFramePath(selectedFrame);

  const rowIndex = keyBytes[rowIndexFromIndices] ?? 0;
  const frame = rows[rowIndex % 16] ?? rows[0];
  if (!frame) throw new Error(`Animation row ${rowIndex % 16} not found in ${rows.length} parsed rows`);

  let frameTime = keyByteIndices.reduce(
    (acc, index) => acc * ((keyBytes[index] ?? 0) % 16),
    1,
  );
  frameTime = Math.round(frameTime / 10) * 10;
  const animationKey = animate(frame, frameTime / 4096);

  const materials: TransactionMaterials = {
    key,
    keyBytes,
    rowIndex: rowIndex % 16,
    keyByteIndices,
    animationKey,
    frameCount: framePaths.length,
    generatedAt: Date.now(),
  };

  return {
    materials,
    generate(method: string, path: string, timeNow?: number): string {
      const seconds = timeNow ?? Math.floor((Date.now() - EPOCH_MS) / 1000);
      const timeBytes = [
        seconds & 0xff,
        (seconds >> 8) & 0xff,
        (seconds >> 16) & 0xff,
        (seconds >> 24) & 0xff,
      ];

      const data = `${method}!${path}!${seconds}${KEYWORD}${animationKey}`;
      const hash = new Uint8Array(createHash('sha256').update(data).digest()).subarray(0, 16);

      const random = Math.floor(Math.random() * 256);
      const bytes = [...materials.keyBytes, ...timeBytes, ...hash, ADDITIONAL_RANDOM_NUMBER];
      const out = new Uint8Array([random, ...bytes.map((b) => b ^ random)]);
      return Buffer.from(out).toString('base64').replace(/=/g, '');
    },
  };
}
