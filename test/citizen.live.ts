#!/usr/bin/env tsx
/**
 * ЖИНХЭНЭ дуудлагын тест — VPN холболт + байгууллагын эрх шаардана.
 * .env бөглөсөн, VPN холбогдсон үед ажиллуулна:
 *
 *   npm run test:live -- УБ99112233
 *   tsx test/citizen.live.ts УБ99112233
 *
 * citizen домэйны WS100101_getCitizenIDCardInfo жишээ.
 */
import { XypClient } from '../src/client';
import { loadConfig } from '../src/config';

async function main(): Promise<void> {
  const regnum = process.argv[2] || process.env.XYP_TEST_REGNUM;
  const cfg = loadConfig();

  const missing: string[] = [];
  if (!cfg.accessToken || /REPLACE_WITH/.test(cfg.accessToken)) missing.push('XYP_ACCESS_TOKEN');
  if (!cfg.privateKeyPath) missing.push('XYP_PRIVATE_KEY_PATH');
  if (!regnum) missing.push('REGNUM (аргумент эсвэл XYP_TEST_REGNUM)');
  if (missing.length) {
    console.error('✖ Дутуу тохиргоо:', missing.join(', '));
    console.error('  .env файлаа бөглөөд, VPN холбогдсон эсэхээ шалгаарай.');
    process.exit(1);
  }

  const domain = process.env.XYP_DOMAIN || 'citizen';
  console.log(`→ Домэйн: ${domain}`);

  let client: XypClient;
  try {
    client = await XypClient.create({
      accessToken: cfg.accessToken as string,
      privateKeyPath: cfg.privateKeyPath,
      privateKeyPassphrase: cfg.privateKeyPassphrase,
      domain,
      caFile: cfg.caFile,
      insecure: cfg.insecure,
    });
  } catch (err) {
    console.error('✖ Клиент үүсгэж чадсангүй (WSDL/VPN/TLS шалгана уу):', (err as Error).message);
    process.exit(2);
    return;
  }

  console.log(`→ ${client.listOperations().length} операц WSDL-д олдлоо.`);

  try {
    const { result, rawResponse } = await client.call('WS100101_getCitizenIDCardInfo', {
      request: {
        regnum,
        auth: {
          citizen: {
            authType: process.env.XYP_AUTH_TYPE || '',
            otp: process.env.XYP_OTP || '',
            fingerprint: '',
            signature: '',
            certFingerprint: '',
          },
        },
      },
    });
    console.log('\n✔ Хариу:');
    console.dir(result, { depth: null });
    if (process.env.XYP_DEBUG === '1') console.log('\n--- raw ---\n', rawResponse);
  } catch (err) {
    console.error('\n✖ Дуудлага амжилтгүй:', (err as Error).message);
    const anyErr = err as { root?: unknown };
    if (anyErr.root) console.error(JSON.stringify(anyErr.root, null, 2));
    process.exit(3);
  }
}

main();
