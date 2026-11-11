import * as soap from 'soap';
import crypto from 'crypto';
import { loadPrivateKey, buildAuth, Auth } from './signature';
import { buildHttpsAgent, HttpsAgentSecurity } from './tls';
import { resolveEndpoint, localWsdlPath } from './endpoints';

export interface CreateOptions {
  accessToken: string;
  /** Хувийн түлхүүр — шууд KeyObject эсвэл файлын зам */
  privateKey?: crypto.KeyObject;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
  /** Үйлчилгээний домэйн: 'citizen' | 'insurance' | 'transport' | 'statistic' | ... */
  domain?: string;
  /** domain-г тойрч шууд endpoint URL өгөх бол */
  baseUrl?: string;
  /** WSDL-ийн URL эсвэл локал зам. Өгөхгүй бол локал wsdl/<domain> эсвэл онлайн */
  wsdl?: string;
  /** Локал татсан WSDL хавтас (default: ./wsdl) */
  wsdlDir?: string;
  caFile?: string;
  insecure?: boolean;
}

export interface CallResult<T = unknown> {
  result: T;
  rawRequest?: string;
  rawResponse?: string;
}

/**
 * XYP SOAP клиент (домэйн бүрт нэг).
 *
 *   const c = await XypClient.create({ accessToken, privateKeyPath, domain: 'citizen' });
 *   const { result } = await c.call('WS100101_getCitizenIDCardInfo', {
 *     request: { regnum: 'УБ99112233' }
 *   });
 */
export class XypClient {
  readonly accessToken: string;
  private readonly privateKey: crypto.KeyObject;
  readonly endpoint: string;
  readonly soapClient: soap.Client;

  private constructor(cfg: {
    accessToken: string;
    privateKey: crypto.KeyObject;
    endpoint: string;
    soapClient: soap.Client;
  }) {
    this.accessToken = cfg.accessToken;
    this.privateKey = cfg.privateKey;
    this.endpoint = cfg.endpoint;
    this.soapClient = cfg.soapClient;
  }

  static async create(opts: CreateOptions): Promise<XypClient> {
    if (!opts.accessToken) throw new Error('accessToken шаардлагатай');

    // endpoint + wsdl-ийг тодорхойлох
    let baseUrl = opts.baseUrl;
    let wsdlLocation = opts.wsdl;
    if (!baseUrl) {
      if (!opts.domain) throw new Error('domain эсвэл baseUrl шаардлагатай');
      const ep = resolveEndpoint(opts.domain);
      baseUrl = ep.base;
      wsdlLocation = wsdlLocation || localWsdlPath(opts.domain, opts.wsdlDir) || ep.url;
    }
    if (!wsdlLocation) wsdlLocation = `${baseUrl}?WSDL`;

    const privateKey =
      opts.privateKey ||
      loadPrivateKey(opts.privateKeyPath as string, opts.privateKeyPassphrase);
    if (!opts.privateKey && !opts.privateKeyPath) {
      throw new Error('privateKey эсвэл privateKeyPath шаардлагатай');
    }

    const httpsAgent = buildHttpsAgent({ caFile: opts.caFile, insecure: opts.insecure });

    const soapClient = await soap.createClientAsync(wsdlLocation, {
      endpoint: baseUrl,
      wsdl_options: { httpsAgent },
    } as soap.IOptions);

    soapClient.setEndpoint(baseUrl);
    soapClient.setSecurity(new HttpsAgentSecurity(httpsAgent) as unknown as soap.ISecurity);

    return new XypClient({ accessToken: opts.accessToken, privateKey, endpoint: baseUrl, soapClient });
  }

  /** Энэ хүсэлтэд зориулж ШИНЭ auth header тавина (timeStamp бүрд шинэ гарын үсэг). */
  private applyAuthHeaders(): Auth {
    const auth = buildAuth({ accessToken: this.accessToken, privateKey: this.privateKey });
    this.soapClient.clearHttpHeaders();
    this.soapClient.addHttpHeader('accessToken', auth.accessToken);
    this.soapClient.addHttpHeader('timeStamp', auth.timeStamp);
    this.soapClient.addHttpHeader('signature', auth.signature);
    return auth;
  }

  /** WSDL-ийн бүтцийг буцаана. */
  describe(): unknown {
    return this.soapClient.describe();
  }

  /** WSDL-д тодорхойлогдсон операцийн нэрс. */
  listOperations(): string[] {
    const desc = this.soapClient.describe() as Record<string, Record<string, Record<string, unknown>>>;
    const ops = new Set<string>();
    for (const svc of Object.values(desc))
      for (const port of Object.values(svc)) for (const op of Object.keys(port)) ops.add(op);
    return [...ops].sort();
  }

  /**
   * XYP операц дуудах.
   * @param operation Жнь: 'WS100101_getCitizenIDCardInfo'
   * @param args      Жнь: { request: { regnum: '...' } }
   */
  async call<T = unknown>(operation: string, args: unknown): Promise<CallResult<T>> {
    const asyncName = `${operation}Async`;
    const client = this.soapClient as unknown as Record<string, unknown>;
    if (typeof client[asyncName] !== 'function') {
      const ops = this.listOperations();
      throw new Error(
        `'${operation}' операц WSDL-д алга. Жишээ: ${ops.slice(0, 5).join(', ')}${ops.length > 5 ? ' …' : ''}`
      );
    }
    this.applyAuthHeaders();
    const fn = client[asyncName] as (a: unknown) => Promise<[T]>;
    const [result] = await fn.call(this.soapClient, args);
    return {
      result,
      rawRequest: this.soapClient.lastRequest,
      rawResponse: (this.soapClient as unknown as { lastResponse?: string }).lastResponse,
    };
  }
}
