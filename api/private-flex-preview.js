const crypto = require('node:crypto');
const { getConfig, createNotionClient } = require('../lib/bot');
const { getTodoReminders, pushLine, taipeiDate } = require('../lib/morning-push');

const TOKEN_HASH = '9e709bcff33530a56c2437d588053135259f261b780e4a24dcaa999fc464eef1';

function authorized(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const actual = crypto.createHash('sha256').update(token).digest();
  const expected = Buffer.from(TOKEN_HASH, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function statusFor(item, today) {
  if (!item.dueDate) return null;
  const days = daysBetween(today, item.dueDate);
  if (days < 0) return { text: `逾期 ${Math.abs(days)} 天`, color: '#D85C5C', weight: 'bold' };
  if (days === 0) return { text: '今天', color: '#A07F54', weight: 'bold' };
  if (days === 1) return { text: '明天', color: '#8A817D' };
  return { text: `${days} 天後`, color: '#8A817D' };
}

function itemRow(item, today) {
  const status = statusFor(item, today);
  const contents = [{
    type: 'text', text: item.name, size: 'sm', color: '#514944', wrap: true, flex: 1,
  }];
  if (status) contents.push({
    type: 'text', text: status.text, size: 'xs', color: status.color,
    weight: status.weight || 'regular', align: 'end', flex: 0, margin: 'md',
  });
  return { type: 'box', layout: 'horizontal', alignItems: 'center', margin: 'sm', contents };
}

function section(title, items, today, margin = 'none') {
  return {
    type: 'box', layout: 'vertical', margin, contents: [
      { type: 'text', text: `【 ${title} 】`, size: 'sm', weight: 'bold', color: '#6F625D' },
      ...items.map((item) => itemRow(item, today)),
    ],
  };
}

function buildPreview(items, today) {
  const shopping = items.filter((item) => item.type.includes('待買'));
  const tasks = items.filter((item) => !item.type.includes('待買'));
  const contents = [];
  if (shopping.length) contents.push(section('待買', shopping, today));
  if (tasks.length) contents.push(section('待辦', tasks, today, contents.length ? 'xl' : 'none'));
  return {
    type: 'flex',
    altText: '待買與待辦版面測試',
    contents: {
      type: 'bubble', size: 'kilo',
      body: {
        type: 'box', layout: 'vertical', paddingAll: '18px',
        contents: [
          { type: 'text', text: '待買與待辦', size: 'md', weight: 'bold', color: '#514944' },
          { type: 'text', text: '新版面預覽', size: 'xs', color: '#A69B96', margin: 'xs' },
          { type: 'separator', margin: 'lg', color: '#E8E1DD' },
          { type: 'box', layout: 'vertical', margin: 'lg', contents },
        ],
      },
    },
  };
}

module.exports = async function privateFlexPreview(req, res) {
  if (req.method !== 'POST') return res.status(405).send('method not allowed');
  if (!authorized(req)) return res.status(401).send('unauthorized');
  try {
    const config = getConfig();
    config.lineUserIds = [process.env.LINE_USER_ID].filter(Boolean);
    if (!config.lineToken || !config.notionToken || !config.lineUserIds.length) {
      return res.status(500).send('configuration error');
    }
    const today = taipeiDate(new Date());
    const notion = createNotionClient(config);
    let items = await getTodoReminders(notion, config.todoDbId, today);
    if (!items.length) items = [
      { name: '延長線（電器用）', type: '🛒 待買清單', dueDate: '2026-10-31' },
      { name: '小的削鉛筆機', type: '🛒 待買清單', dueDate: '' },
      { name: '換汽車玩具', type: '✅ 待辦事項', dueDate: '2026-10-17' },
      { name: '組裝書架', type: '✅ 待辦事項', dueDate: '' },
    ];
    const sent = await pushLine(buildPreview(items, today), config);
    return res.status(200).json({ sent, items: items.length });
  } catch (error) {
    console.error('Private Flex preview failed', error);
    return res.status(500).send('push failed');
  }
};

module.exports._test = { authorized, buildPreview };
