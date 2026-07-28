const crypto = require('crypto');

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function safeDate(value = '') {
  const date = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
}

function extensionFor(contentType) {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  return 'jpg';
}

function decodeImage(imageBase64, contentType) {
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    throw new Error('unsupported image type');
  }
  const normalized = String(imageBase64 || '').replace(
    /^data:image\/(?:jpeg|png|webp);base64,/i,
    '',
  );
  if (!normalized || !/^[A-Za-z0-9+/=\r\n]+$/.test(normalized)) {
    throw new Error('invalid image data');
  }
  const bytes = Buffer.from(normalized, 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error('image size must be between 1 byte and 4 MB');
  }
  return bytes;
}

async function uploadHoroscopeImage({
  imageBase64,
  contentType,
  date,
  putImpl,
}) {
  const bytes = decodeImage(imageBase64, contentType);
  const put = putImpl || (await import('@vercel/blob')).put;
  const suffix = crypto.randomBytes(6).toString('hex');
  const pathname = `horoscope/${safeDate(date)}-${suffix}.${extensionFor(contentType)}`;
  const blob = await put(pathname, bytes, {
    access: 'public',
    contentType,
    addRandomSuffix: false,
  });
  if (!blob?.url || !String(blob.url).startsWith('https://')) {
    throw new Error('image upload failed');
  }
  return blob.url;
}

async function pushToLine({ text, imageUrl, lineToken, lineUserId, fetchImpl = fetch }) {
  const messageText = String(text || '').trim();
  if (!messageText || messageText.length > 5000) {
    throw new Error('text must be between 1 and 5000 characters');
  }
  if (!lineToken || !lineUserId) throw new Error('LINE push is not configured');

  const messages = [{ type: 'text', text: messageText }];
  if (imageUrl) {
    messages.push({
      type: 'image',
      originalContentUrl: imageUrl,
      previewImageUrl: imageUrl,
    });
  }

  const response = await fetchImpl('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${lineToken}`,
    },
    body: JSON.stringify({ to: lineUserId, messages }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`LINE Push API ${response.status}: ${detail.slice(0, 300)}`);
  }
  return messages.length;
}

async function uploadAndPushHoroscope(input, deps = {}) {
  const contentType = String(input.imageMimeType || 'image/jpeg').toLowerCase();
  const imageUrl = await uploadHoroscopeImage({
    imageBase64: input.imageBase64,
    contentType,
    date: input.date,
    putImpl: deps.putImpl,
  });
  const messages = await pushToLine({
    text: input.text,
    imageUrl,
    lineToken: deps.lineToken || process.env.LINE_TOKEN,
    lineUserId: deps.lineUserId || process.env.LINE_USER_ID,
    fetchImpl: deps.fetchImpl,
  });
  return { messages, imageUrl };
}

module.exports = {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  safeDate,
  decodeImage,
  uploadHoroscopeImage,
  pushToLine,
  uploadAndPushHoroscope,
};
