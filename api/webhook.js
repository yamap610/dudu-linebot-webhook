const crypto = require('crypto');
const {
  getConfig,
  validateConfig,
  createNotionClient,
  parseTextCommand,
  parsePostback,
  handleCommand,
} = require('../lib/bot');

module.exports.config = {
  api: { bodyParser: false },
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verifySignature(rawBody, signature, channelSecret) {
  if (!signature || !channelSecret) return false;
  const expected = crypto.createHmac('SHA256', channelSecret).update(rawBody).digest();
  let received;
  try { received = Buffer.from(signature, 'base64'); } catch { return false; }
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

async function replyLine(replyToken, messages, lineToken, fetchImpl = fetch) {
  if (!replyToken || !messages?.length) return;
  const response = await fetchImpl('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${lineToken}`,
    },
    body: JSON.stringify({ replyToken, messages: messages.slice(0, 5) }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`LINE Reply API ${response.status}: ${detail.slice(0, 300)}`);
  }
}

async function processEvent(event, notion, config) {
  let command = null;
  if (event.type === 'message' && event.message?.type === 'text') {
    command = parseTextCommand(event.message.text);
  } else if (event.type === 'postback') {
    command = { ...parsePostback(event.postback?.data), ...(event.postback?.params || {}) };
  } else if (event.type === 'follow') {
    command = { action: 'menu' };
  }
  if (!command) return;

  try {
    const messages = await handleCommand(command, notion, config);
    await replyLine(event.replyToken, messages, config.lineToken);
  } catch (error) {
    console.error('處理 LINE 事件失敗', {
      eventType: event.type,
      action: command.action,
      message: error.message,
    });
    await replyLine(event.replyToken, [{
      type: 'text',
      text: '處理時發生錯誤，資料沒有異動。請稍後再試一次 🙏',
      quickReply: { items: [{ type: 'action', action: { type: 'postback', label: '🏠 主選單', data: 'action=menu' } }] },
    }], config.lineToken).catch((replyError) => console.error('錯誤訊息回覆失敗', replyError.message));
  }
}

module.exports = async function webhook(req, res) {
  if (req.method !== 'POST') {
    res.status(200).send('ok');
    return;
  }

  const config = getConfig();
  try {
    validateConfig(config);
  } catch (error) {
    console.error(error.message);
    res.status(500).send('configuration error');
    return;
  }

  let rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch {
    res.status(400).send('bad request');
    return;
  }

  if (!verifySignature(rawBody, req.headers['x-line-signature'], config.channelSecret)) {
    res.status(401).send('invalid signature');
    return;
  }

  let body;
  try {
    body = JSON.parse(rawBody.toString('utf8') || '{}');
  } catch {
    res.status(400).send('invalid json');
    return;
  }

  const notion = createNotionClient(config);
  await Promise.all((body.events || []).map((event) => processEvent(event, notion, config)));
  res.status(200).send('ok');
};

module.exports._test = { getRawBody, verifySignature, replyLine, processEvent };
