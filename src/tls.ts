import fs from 'fs';
import https from 'https';

/**
 * TLS тохиргоог нэг дор шийдэх туслах.
 *
 * Санамж: XYP endpoint нь MN үндэсний CA (MNRCA/MNICA)-гаар гарын үсэглэгдсэн.
 * Зөв арга: эдгээр CA-г OS/Node итгэмжлэлд суулгах (README / guide-г үз).
 * Боломжгүй үед CA файлыг XYP_CA_FILE-р дамжуулж өгнө.
 * XYP_INSECURE_TLS=1 нь шалгалтыг бүрэн унтраана — ЗӨВХӨН локал тестэд.
 */
export function buildHttpsAgent(opts: { caFile?: string; insecure?: boolean } = {}): https.Agent {
  const agentOpts: https.AgentOptions = { keepAlive: true };
  if (opts.caFile) agentOpts.ca = fs.readFileSync(opts.caFile);
  if (opts.insecure) agentOpts.rejectUnauthorized = false;
  return new https.Agent(agentOpts);
}

/**
 * node-soap-ийн security interface. Бодит SOAP дуудлагын axios тохиргоонд
 * манай https.Agent-ийг оруулж өгөхөд ашиглана (TLS/CA зориулалтаар).
 */
export class HttpsAgentSecurity {
  constructor(private readonly agent: https.Agent) {}
  addOptions(options: Record<string, unknown>): void {
    options.httpsAgent = this.agent;
  }
  addHeaders(): void {}
  toXML(): string {
    return '';
  }
}
