import crypto from 'crypto';
import fs from 'fs';

/**
 * XYP гарын үсэг үүсгэх.
 *
 * Албан ёсны томьёо (developer.xyp.gov.mn/docs/1.5.0/examples):
 *   keyData   = accessToken + "." + timeStamp
 *   signature = Base64( RSA_SHA256_Sign(privateKey, keyData) )
 *
 * Хүсэлт бүрд ШИНЭ timeStamp ашиглана — сервер хуучин timeStamp-ийг татгалзана.
 */

export type PrivateKeyInput = crypto.KeyObject | string | Buffer;

export interface Auth {
  accessToken: string;
  timeStamp: string;
  signature: string;
  keyData: string;
}

/** Файлаас хувийн түлхүүр ачаалах (PEM эсвэл DER). */
export function loadPrivateKey(keyPath: string, passphrase?: string): crypto.KeyObject {
  const raw = fs.readFileSync(keyPath);
  const isPem = raw.subarray(0, 32).toString('utf8').includes('-----BEGIN');
  const opts: crypto.PrivateKeyInput = isPem
    ? { key: raw, format: 'pem' }
    : { key: raw, format: 'der', type: 'pkcs8' };
  if (passphrase) opts.passphrase = passphrase;
  return crypto.createPrivateKey(opts);
}

/** Нэг хүсэлтэд зориулж auth утгуудыг (timeStamp + signature) үүсгэнэ. */
export function buildAuth(p: {
  accessToken: string;
  privateKey: PrivateKeyInput;
  timeStamp?: number;
}): Auth {
  if (!p.accessToken) throw new Error('accessToken шаардлагатай');
  if (!p.privateKey) throw new Error('privateKey шаардлагатай');

  const ts = p.timeStamp != null ? Number(p.timeStamp) : Math.floor(Date.now() / 1000);
  const keyData = `${p.accessToken}.${ts}`;

  const signer = crypto.createSign('SHA256');
  signer.update(keyData, 'utf8');
  signer.end();
  const signature = signer.sign(p.privateKey as crypto.KeyLike, 'base64');

  return {
    accessToken: String(p.accessToken),
    timeStamp: String(ts),
    signature,
    keyData,
  };
}

/** Гарын үсгийг нийтийн түлхүүрээр шалгах (локал тест/дибагт тустай). */
export function verifyAuth(p: {
  accessToken: string;
  timeStamp: string | number;
  signature: string;
  publicKey: crypto.KeyLike;
}): boolean {
  const keyData = `${p.accessToken}.${p.timeStamp}`;
  const verifier = crypto.createVerify('SHA256');
  verifier.update(keyData, 'utf8');
  verifier.end();
  return verifier.verify(p.publicKey, p.signature, 'base64');
}
