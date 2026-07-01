const crypto = require('crypto');

// Vercel 設定：關掉自動 body parser，因為驗證 LINE 簽章需要用「原始」的請求內容
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

// ── 環境變數 ──────────────────────────────
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const LINE_TOKEN = process.env.LINE_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const BILL_DB_ID = process.env.BILL_DB_ID;
const TODO_DB_ID = process.env.TODO_DB_ID;

const notionHeaders = {
  Authorization: `Bearer ${NOTION_TOKEN}`,
  'Content-Type': 'application/json',
  'Notion-Version': '2022-06-28',
};

// ── 工具函式 ──────────────────────────────
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function verifySignature(rawBody, signature, channelSecret) {
  if (!signature) return false;
  const hash = crypto
    .createHmac('SHA256', channelSecret)
    .update(rawBody)
    .digest('base64');
  return hash === signature;
}

async function queryDb(dbId, body) {
  const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST',
    headers: notionHeaders,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return data.results || [];
}

function getTitleText(page, propName) {
  const prop = page.properties[propName];
  const texts = (prop && prop.title) || [];
  return texts.length > 0 ? texts[0].plain_text : '（無標題）';
}

// ── 繳費提醒（7天內） ──────────────────────
async function getBills() {
  const now = new Date();
  const twMs = now.getTime() + 8 * 60 * 60 * 1000; // 轉台灣時間
  const tw = new Date(twMs);
  const today = new Date(Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), tw.getUTCDate()));
  const oneWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

  const results = await queryDb(BILL_DB_ID, {
    sorts: [{ property: '下次繳費', direction: 'ascending' }],
  });

  const lines = [];
  for (const p of results) {
    const name = getTitleText(p, '名稱');
    const formulaProp = p.properties['下次繳費'] || {};
    const formulaVal = formulaProp.formula || {};
    let dateStr = '';
    if (formulaVal.type === 'string') dateStr = formulaVal.string || '';
    else if (formulaVal.type === 'date') dateStr = (formulaVal.date && formulaVal.date.start) || '';
    if (!dateStr) continue;

    const billDate = new Date(dateStr.slice(0, 10) + 'T00:00:00Z');
    if (isNaN(billDate.getTime())) continue;
    if (!(billDate >= today && billDate <= oneWeek)) continue;

    const priceProp = p.properties['價格'] || {};
    const price = priceProp.number;
    const priceStr = price ? `$${price.toLocaleString()}` : '';
    const mmdd = `${String(billDate.getUTCMonth() + 1).padStart(2, '0')}/${String(billDate.getUTCDate()).padStart(2, '0')}`;
    lines.push(`▪️ ${name} ${mmdd} ${priceStr}`.trim());
  }
  return lines;
}

// ── 待買 / 待辦（共用邏輯） ─────────────────
async function getTodosByType(attrName) {
  const results = await queryDb(TODO_DB_ID, {
    filter: {
      and: [
        { property: '完成', checkbox: { equals: false } },
        { property: '屬性', select: { equals: attrName } },
      ],
    },
    sorts: [{ property: '優先級', direction: 'ascending' }],
  });

  const priorityTag = { 急: '[急]', 中: '[中]', 緩: '[緩]' };
  const urgent = [];
  let others = 0;

  for (const p of results) {
    const nameProp = p.properties['項目名稱'] || {};
    const texts = nameProp.title || [];
    const name = texts.length > 0 ? texts[0].plain_text : '（無標題）';

    const priProp = p.properties['優先級'] || {};
    const priSel = priProp.select;
    const priName = priSel ? priSel.name : '';
    const tag = priorityTag[priName] || '';

    if (priName === '急') {
      urgent.push(`▪️ ${tag} ${name}`.trim());
    } else {
      others += 1;
    }
  }
  return { urgent, others };
}

// ── 組合各種回覆訊息 ──────────────────────
async function buildBillsMessage() {
  const bills = await getBills();
  let msg = '📊 7天內繳費提醒\n';
  msg += bills.length ? bills.join('\n') : '▪️ 這幾天沒有到期帳單';
  return msg;
}

async function buildBuyMessage() {
  const { urgent, others } = await getTodosByType('🛒 待買清單');
  let msg = '🛒 待買清單\n';
  msg += urgent.length ? urgent.join('\n') : '▪️ 沒有急需購買的項目';
  if (others > 0) msg += `\n（另有 ${others} 項待購）`;
  return msg;
}

async function buildTodoMessage() {
  const { urgent, others } = await getTodosByType('✅ 待辦事項');
  let msg = '✅ 待辦事項\n';
  msg += urgent.length ? urgent.join('\n') : '▪️ 沒有急需處理的事項';
  if (others > 0) msg += `\n（另有 ${others} 項待辦）`;
  return msg;
}

function buildHelpMessage() {
  return (
    '嘟嘟一家小幫手 🐰\n\n' +
    '輸入「待買」→ 查看待買清單\n' +
    '輸入「待辦」→ 查看待辦事項\n' +
    '輸入「繳費」→ 查看7天內繳費提醒'
  );
}

// ── 回覆 LINE ──────────────────────────────
async function replyLine(replyToken, text) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LINE_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text }],
    }),
  });
}

// ── 主要進入點 ──────────────────────────────
module.exports = async (req, res) => {
  // LINE Developers 後台驗證 Webhook 時，會送一個沒有事件內容的請求，
  // 只要回 200 就算成功，不用真的處理內容
  if (req.method !== 'POST') {
    res.status(200).send('ok');
    return;
  }

  let rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch (err) {
    res.status(400).send('bad request');
    return;
  }

  const signature = req.headers['x-line-signature'];
  if (!verifySignature(rawBody, signature, LINE_CHANNEL_SECRET)) {
    res.status(401).send('invalid signature');
    return;
  }

  let body;
  try {
    body = JSON.parse(rawBody || '{}');
  } catch (err) {
    res.status(200).send('ok'); // 驗證請求 body 可能是空的，也要回 200
    return;
  }

  const events = body.events || [];

  for (const event of events) {
    if (event.type === 'message' && event.message && event.message.type === 'text') {
      const text = (event.message.text || '').trim();
      let replyText = null;

      try {
        if (text.includes('待買')) {
          replyText = await buildBuyMessage();
        } else if (text.includes('待辦')) {
          replyText = await buildTodoMessage();
        } else if (text.includes('繳費')) {
          replyText = await buildBillsMessage();
        } else if (text.includes('幫助') || text.toLowerCase() === 'help') {
          replyText = buildHelpMessage();
        }
      } catch (err) {
        replyText = '查詢時發生錯誤，稍後再試一次 🙏';
        console.error(err);
      }

      if (replyText) {
        await replyLine(event.replyToken, replyText);
      }
    }
  }

  res.status(200).send('ok');
};
