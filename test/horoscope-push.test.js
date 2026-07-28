const test = require('node:test');
const assert = require('node:assert/strict');
const {
  decodeImage,
  uploadAndPushHoroscope,
} = require('../lib/horoscope-push');

test('decodeImage accepts a small JPEG data URL', () => {
  const bytes = decodeImage('data:image/jpeg;base64,aGVsbG8=', 'image/jpeg');
  assert.equal(bytes.toString('utf8'), 'hello');
});

test('decodeImage rejects unsupported content types', () => {
  assert.throws(
    () => decodeImage('aGVsbG8=', 'image/gif'),
    /unsupported image type/,
  );
});

test('uploadAndPushHoroscope uploads once and pushes only to fixed recipient', async () => {
  const calls = [];
  const result = await uploadAndPushHoroscope({
    date: '2026-07-28',
    text: '今日運勢',
    imageBase64: 'aGVsbG8=',
    imageMimeType: 'image/jpeg',
  }, {
    lineToken: 'line-token',
    lineUserId: 'fixed-user',
    putImpl: async (pathname, bytes, options) => {
      calls.push({ type: 'put', pathname, bytes: bytes.toString(), options });
      return { url: 'https://example.public.blob.vercel-storage.com/card.jpg' };
    },
    fetchImpl: async (url, options) => {
      calls.push({ type: 'fetch', url, options });
      return { ok: true };
    },
  });

  assert.equal(result.messages, 2);
  assert.match(result.imageUrl, /^https:\/\//);
  assert.equal(calls[0].type, 'put');
  assert.match(calls[0].pathname, /^horoscope\/2026-07-28-/);
  const payload = JSON.parse(calls[1].options.body);
  assert.equal(payload.to, 'fixed-user');
  assert.deepEqual(payload.messages.map((item) => item.type), ['text', 'image']);
});
