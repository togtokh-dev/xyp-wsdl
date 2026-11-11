import 'dotenv/config';
import path from 'path';
import { DEFAULT_HOST, DEFAULT_VERSION } from './endpoints';

export interface XypConfig {
  accessToken?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
  caFile?: string;
  insecure: boolean;
  host: string;
  version: string;
}

/** .env-ээс нийтлэг тохиргоо (эрх + TLS + host/version) уншина. */
export function loadConfig(overrides: Partial<XypConfig> = {}): XypConfig {
  return {
    accessToken: process.env.XYP_ACCESS_TOKEN,
    privateKeyPath: process.env.XYP_PRIVATE_KEY_PATH
      ? path.resolve(process.env.XYP_PRIVATE_KEY_PATH)
      : undefined,
    privateKeyPassphrase: process.env.XYP_PRIVATE_KEY_PASSPHRASE || undefined,
    caFile: process.env.XYP_CA_FILE || undefined,
    insecure: process.env.XYP_INSECURE_TLS === '1',
    host: process.env.XYP_HOST || DEFAULT_HOST,
    version: process.env.XYP_VERSION || DEFAULT_VERSION,
    ...overrides,
  };
}
