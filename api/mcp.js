const crypto = require('crypto');
const { uploadAndPushHoroscope } = require('../lib/horoscope-push');

const TOOL = {
  name: 'push_private_horoscope',
  title: '推送私人星座故事卡',
  description: '將今日運勢文字與故事卡圖片推送到已固定設定的單一 LINE 收件者。不可指定其他收件者。',
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['date', 'text', 'imageBase64', 'imageMimeType'],
    properties: {
      date: {
        type: 'string',
        description: 'Asia/Taipei 日期，格式 YYYY-MM-DD。',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      },
      text: {
        type: 'string',
        description: '正體中文運勢摘要，需包含整體、愛情、事業、財運、幸運色與幸運數字。',
        minLength: 1,
        maxLength: 5000,
      },
      imageBase64: {
        type: 'string',
        description: '故事卡圖片的純 base64 或 data URL；解碼後不得超過 4 MB。',
        minLength: 1,
      },
      imageMimeType: {
        type: 'string',
        enum: ['image/jpeg', 'image/png', 'image/webp'],
      },
    },
  },
};

function secureEqual(actual, expected) {
  if (!actual || !expected) return false;
  const a = Buffer.from(String(actual));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function authorized(req) {
  return secureEqual(req.headers['x-dudu-key'], process.env.LINE_MCP_KEY);
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

module.exports = async function mcp(req, res) {
  if (req.method !== 'POST') return res.status(405).send('method not allowed');
  if (!authorized(req)) return res.status(401).send('unauthorized');

  const body = req.body || {};
  const { id, method, params = {} } = body;

  if (method === 'initialize') {
    return res.status(200).json(rpcResult(id, {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'dudu-private-line-push', version: '1.0.0' },
    }));
  }
  if (method === 'notifications/initialized') return res.status(202).end();
  if (method === 'tools/list') {
    return res.status(200).json(rpcResult(id, { tools: [TOOL] }));
  }
  if (method === 'tools/call') {
    if (params.name !== TOOL.name) {
      return res.status(200).json(rpcError(id, -32601, 'unknown tool'));
    }
    try {
      const result = await uploadAndPushHoroscope(params.arguments || {});
      return res.status(200).json(rpcResult(id, {
        content: [{
          type: 'text',
          text: `已推送 ${result.messages} 則訊息到固定的私人 LINE 收件者。`,
        }],
        structuredContent: { sent: true, messages: result.messages },
      }));
    } catch (error) {
      console.error('Private horoscope push failed', error);
      return res.status(200).json(rpcResult(id, {
        isError: true,
        content: [{ type: 'text', text: `推送失敗：${error.message}` }],
      }));
    }
  }
  return res.status(200).json(rpcError(id, -32601, 'method not found'));
};

module.exports._test = { TOOL, secureEqual, authorized, rpcResult, rpcError };
