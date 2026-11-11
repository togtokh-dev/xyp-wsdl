#!/usr/bin/env tsx
/**
 * XYP WSDL татагч (TypeScript).
 *
 * Эхлэл URL-ээс WSDL-ийг татаж, дотор нь байгаа <xsd:import schemaLocation>,
 * <xsd:include>, <wsdl:import location> зэргийг РЕКУРСИВЭЭР дагаж бүх XSD-г
 * татаад, лавлагаануудыг локал файлын нэр рүү дахин холбож хадгална.
 *
 * Хэрэглээ:
 *   npm run download:all                                   # endpoints.json доторх бүгд → wsdl/<name>/
 *   npm run download:wsdl -- https://xyp.gov.mn/citizen-1.5.0/ws?WSDL
 *   tsx scripts/download-wsdl.ts --all --out wsdl
 *
 * TLS: .env доторх XYP_CA_FILE / XYP_INSECURE_TLS-ийг хүндэтгэнэ.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import { loadEndpoints } from '../src/endpoints';

interface Args {
  _: string[];
  out?: string;
  name?: string;
  endpoints?: string;
  all?: boolean;
  insecure?: boolean;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--name') args.name = argv[++i];
    else if (a === '--endpoints') args.endpoints = argv[++i];
    else if (a === '--all') args.all = true;
    else if (a === '--insecure') args.insecure = true;
    else args._.push(a);
  }
  return args;
}

export function sanitizeName(urlStr: string, fallback: string): string {
  try {
    const u = new URL(urlStr);
    let base = path.basename(u.pathname);
    if (!base || base === '/' || base === 'ws') base = '';
    const q = u.search.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!base) base = q || fallback;
    if (!/\.(wsdl|xsd|xml)$/i.test(base)) base += q && /xsd/i.test(q) ? '.xsd' : '.wsdl';
    return base.replace(/[^a-zA-Z0-9._-]+/g, '_');
  } catch {
    return fallback;
  }
}

export function fetchText(
  urlStr: string,
  opts: { caFile?: string; insecure?: boolean; redirects?: number } = {}
): Promise<string> {
  const { caFile, insecure, redirects = 5 } = opts;
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'http:' ? http : https;
    const reqOpts: https.RequestOptions = {
      method: 'GET',
      headers: { 'User-Agent': 'xyp-wsdl-downloader' },
    };
    if (u.protocol === 'https:') {
      if (caFile) reqOpts.ca = fs.readFileSync(caFile);
      if (insecure) reqOpts.rejectUnauthorized = false;
    }
    const req = lib.request(u, reqOpts, (res) => {
      const status = res.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, u).toString();
        return resolve(fetchText(next, { caFile, insecure, redirects: redirects - 1 }));
      }
      if (status !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${status} — ${urlStr}`));
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error(`Timeout — ${urlStr}`)));
    req.end();
  });
}

/** WSDL/XSD текстээс дагах лавлагаануудыг олох (schemaLocation, import location). */
export function extractRefs(text: string): string[] {
  const refs = new Set<string>();
  const reSchema = /schemaLocation\s*=\s*(["'])(.*?)\1/g;
  const reImport = /<(?:[a-zA-Z0-9]+:)?import\b[^>]*\blocation\s*=\s*(["'])(.*?)\1/g;
  let m: RegExpExecArray | null;
  while ((m = reSchema.exec(text)) !== null) refs.add(m[2]);
  while ((m = reImport.exec(text)) !== null) refs.add(m[2]);
  return [...refs].filter((r) => r && !r.startsWith('#'));
}

/** Эхлэл URL-ээс WSDL + импортлосон XSD-г рекурсивээр татаж локал болгоно. */
export async function downloadAll(p: {
  startUrl: string;
  outDir: string;
  caFile?: string;
  insecure?: boolean;
  name?: string;
  log?: (s: string) => void;
}): Promise<{ rootName: string; files: string[] }> {
  const log = p.log || (() => {});
  fs.mkdirSync(p.outDir, { recursive: true });

  const seen = new Map<string, string>();
  const queue: string[] = [];
  const rootName = p.name || sanitizeName(p.startUrl, 'service.wsdl');
  seen.set(p.startUrl, rootName);
  queue.push(p.startUrl);

  const files: string[] = [];
  while (queue.length) {
    const url = queue.shift() as string;
    const localName = seen.get(url) as string;
    let text: string;
    try {
      text = await fetchText(url, { caFile: p.caFile, insecure: p.insecure });
    } catch (err) {
      log(`  ✖ ${localName}: ${(err as Error).message}`);
      continue;
    }

    const refs = extractRefs(text);
    let rewritten = text;
    for (const ref of refs) {
      let absolute: string;
      try {
        absolute = new URL(ref, url).toString();
      } catch {
        continue;
      }
      if (!seen.has(absolute)) {
        const base = sanitizeName(absolute, `import_${seen.size}.xsd`);
        let unique = base;
        let i = 1;
        const taken = new Set(seen.values());
        while (taken.has(unique)) unique = base.replace(/(\.\w+)$/, `_${i++}$1`);
        seen.set(absolute, unique);
        queue.push(absolute);
      }
      rewritten = rewritten.split(ref).join(seen.get(absolute) as string);
    }

    fs.writeFileSync(path.join(p.outDir, localName), rewritten, 'utf8');
    files.push(localName);
    log(`  ✓ ${localName}${refs.length ? `  (${refs.length} лавлагаа)` : ''}`);
  }
  return { rootName, files };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const baseOut = path.resolve(args.out || 'wsdl');
  const caFile = process.env.XYP_CA_FILE || undefined;
  const insecure = args.insecure || process.env.XYP_INSECURE_TLS === '1';
  if (insecure) console.warn('⚠  TLS шалгалт УНТРААЛТТАЙ (локал тестэд л хэрэглэнэ).');

  // ── Горим 1: --all → endpoints.json доторх бүх домэйн ──
  if (args.all) {
    const eps = loadEndpoints(args.endpoints);
    if (!eps.length) {
      console.error('✖ endpoints.json дотор endpoint алга.');
      process.exit(1);
    }
    console.log(`→ ${eps.length} endpoint татна (endpoints.json):`);
    let okCount = 0;
    const failed: string[] = [];
    for (const ep of eps) {
      const outDir = path.join(baseOut, ep.name);
      console.log(`\n■ ${ep.name}  ${ep.url}`);
      try {
        const { rootName, files } = await downloadAll({
          startUrl: ep.url,
          outDir,
          caFile,
          insecure,
          name: `${ep.name}.wsdl`,
          log: (s) => console.log(s),
        });
        if (files.length) {
          okCount++;
          console.log(`  → ${files.length} файл → ${path.join(outDir, rootName)}`);
        } else failed.push(ep.name);
      } catch (err) {
        console.error(`  ✖ ${ep.name}: ${(err as Error).message}`);
        failed.push(ep.name);
      }
    }
    console.log(`\n✔ ${okCount}/${eps.length} endpoint амжилттай.`);
    if (failed.length) console.log(`  ✖ Амжилтгүй: ${failed.join(', ')} (VPN холболтоо шалгана уу)`);
    return;
  }

  // ── Горим 2: нэг URL ──
  const startUrl =
    args._[0] ||
    process.env.XYP_WSDL_URL ||
    (process.env.XYP_BASE_URL ? `${process.env.XYP_BASE_URL}?WSDL` : undefined);

  if (!startUrl) {
    console.error(
      '✖ WSDL URL алга. Жишээ:\n' +
        '  tsx scripts/download-wsdl.ts https://xyp.gov.mn/citizen-1.5.0/ws?WSDL\n' +
        '  эсвэл бүгдийг: npm run download:all'
    );
    process.exit(1);
  }

  console.log(`→ Эх WSDL: ${startUrl}`);
  console.log(`→ Хадгалах: ${baseOut}`);
  const { rootName, files } = await downloadAll({
    startUrl,
    outDir: baseOut,
    caFile,
    insecure,
    name: args.name,
    log: (s) => console.log(s),
  });
  console.log(`\n✔ Дууслаа. ${files.length} файл татлаа → ${baseOut}`);
  console.log(`  Үндсэн WSDL: ${path.join(baseOut, rootName)}`);
}

if (require.main === module) {
  main().catch((err: Error) => {
    console.error('✖ Алдаа:', err.message);
    process.exit(1);
  });
}
