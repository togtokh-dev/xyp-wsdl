import { test } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { buildAuth, verifyAuth } from '../src/signature';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

test('buildAuth нь keyData-г accessToken.timeStamp хэлбэрээр угсарна', () => {
  const auth = buildAuth({ accessToken: 'TOKEN123', privateKey, timeStamp: 1700000000 });
  assert.strictEqual(auth.keyData, 'TOKEN123.1700000000');
  assert.strictEqual(auth.accessToken, 'TOKEN123');
  assert.strictEqual(auth.timeStamp, '1700000000');
  assert.ok(auth.signature.length > 0);
});

test('signature нь RSA-SHA256, Base64 бөгөөд нийтийн түлхүүрээр батлагдана', () => {
  const auth = buildAuth({ accessToken: 'ABC', privateKey, timeStamp: 1700000001 });
  assert.match(auth.signature, /^[A-Za-z0-9+/]+={0,2}$/);
  const ok = verifyAuth({
    accessToken: 'ABC',
    timeStamp: '1700000001',
    signature: auth.signature,
    publicKey,
  });
  assert.strictEqual(ok, true);
});

test('өөр timeStamp → өөр гарын үсэг (replay-аас сэргийлнэ)', () => {
  const a = buildAuth({ accessToken: 'X', privateKey, timeStamp: 1 });
  const b = buildAuth({ accessToken: 'X', privateKey, timeStamp: 2 });
  assert.notStrictEqual(a.signature, b.signature);
});

test('timeStamp өгөхгүй бол одоогийн Unix секундыг ашиглана', () => {
  const before = Math.floor(Date.now() / 1000);
  const auth = buildAuth({ accessToken: 'X', privateKey });
  const after = Math.floor(Date.now() / 1000);
  const ts = Number(auth.timeStamp);
  assert.ok(ts >= before && ts <= after);
});

test('accessToken дутуу бол алдаа шиднэ', () => {
  assert.throws(() => buildAuth({ accessToken: '', privateKey }), /accessToken/);
});
