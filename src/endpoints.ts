import fs from 'fs';
import path from 'path';

/**
 * XYP нь үйлчилгээг домэйнээр нь тусдаа WSDL endpoint-д хуваадаг:
 *   https://xyp.gov.mn/citizen-1.5.0/ws?WSDL
 *   https://xyp.gov.mn/insurance-1.5.0/ws?WSDL
 *   https://xyp.gov.mn/transport-1.5.0/ws?WSDL
 *   https://xyp.gov.mn/statistic-1.5.0/ws?WSDL   ... гэх мэт
 *
 * Домэйн бүрийн жагсаалтыг endpoints.json дотор удирдана.
 */

export const DEFAULT_HOST = 'https://xyp.gov.mn';
export const DEFAULT_VERSION = '1.5.0';

export interface Endpoint {
  name: string;
  ns?: string;
  base: string; // ?WSDL-гүй үндсэн URL (дуудлага энд очно)
  url: string; // ?WSDL-тэй
}

interface EndpointsFile {
  host?: string;
  version?: string;
  endpoints?: { name: string; ns?: string; url?: string }[];
}

/** domain → endpoint үндсэн URL (?WSDL-гүй) */
export function endpointUrl(
  name: string,
  { host = DEFAULT_HOST, version = DEFAULT_VERSION }: { host?: string; version?: string } = {}
): string {
  return `${host}/${name}-${version}/ws`;
}

/** domain → WSDL URL (?WSDL-тэй) */
export function wsdlUrl(name: string, opts?: { host?: string; version?: string }): string {
  return `${endpointUrl(name, opts)}?WSDL`;
}

/**
 * endpoints.json-г уншиж, бүрэн тодорхойлолттой жагсаалт буцаана.
 * url хоосон бол host+version-оос автоматаар үүсгэнэ.
 */
export function loadEndpoints(file?: string): Endpoint[] {
  const jsonPath = file || path.resolve(process.cwd(), 'endpoints.json');
  if (!fs.existsSync(jsonPath)) {
    return ['citizen', 'insurance', 'transport', 'statistic'].map((name) => ({
      name,
      base: endpointUrl(name),
      url: wsdlUrl(name),
    }));
  }
  const cfg = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as EndpointsFile;
  const host = cfg.host || DEFAULT_HOST;
  const version = cfg.version || DEFAULT_VERSION;
  return (cfg.endpoints || []).map((e) => {
    const base = e.url ? e.url.replace(/\?wsdl.*$/i, '') : endpointUrl(e.name, { host, version });
    const url = e.url || wsdlUrl(e.name, { host, version });
    return { name: e.name, ns: e.ns, base, url };
  });
}

/** Нэг домэйны тодорхойлолтыг нэрээр нь олох (endpoints.json-д байхгүй бол pattern-аар) */
export function resolveEndpoint(name: string, file?: string): Endpoint {
  const found = loadEndpoints(file).find((e) => e.name === name);
  if (found) return found;
  return { name, base: endpointUrl(name), url: wsdlUrl(name) };
}

/** Татсан локал WSDL файлын зам (wsdl/<name>/<name>.wsdl) — байвал буцаана */
export function localWsdlPath(name: string, wsdlDir?: string): string | null {
  const dir = wsdlDir || path.resolve(process.cwd(), 'wsdl');
  const p = path.join(dir, name, `${name}.wsdl`);
  return fs.existsSync(p) ? p : null;
}
