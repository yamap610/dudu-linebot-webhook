const { createCalendarClient, addDays, eventTimeRange } = require('./calendar');

const TW_OFFSET_MS = 8 * 60 * 60 * 1000;

function taipeiDate(now = new Date()) {
  return new Date(now.getTime() + TW_OFFSET_MS).toISOString().slice(0, 10);
}

function propertyTitle(properties = {}) {
  for (const property of Object.values(properties)) {
    if (property?.type === 'title') {
      return (property.title || []).map((item) => item.plain_text || item.text?.content || '').join('').trim();
    }
  }
  return '未命名項目';
}

function formulaDate(property) {
  const formula = property?.formula || {};
  if (formula.type === 'string') return String(formula.string || '').slice(0, 10);
  if (formula.type === 'date') return String(formula.date?.start || '').slice(0, 10);
  return '';
}

function numberProperty(properties = {}, names = ['價格', '金額']) {
  for (const name of names) {
    const value = properties[name]?.number;
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function daysBetween(from, to) {
  return Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000);
}

async function getUpcomingBills(notion, billDbId, today) {
  const pages = await notion.queryAll(billDbId, {
    sorts: [{ property: '下次繳費', direction: 'ascending' }],
  });
  return pages.map((page) => {
    const properties = page.properties || {};
    return {
      name: propertyTitle(properties),
      dueDate: formulaDate(properties['下次繳費']),
      price: numberProperty(properties),
      paused: Boolean(properties['暫停訂閱']?.checkbox),
    };
  }).filter((bill) => {
    const days = bill.dueDate ? daysBetween(today, bill.dueDate) : -1;
    // 「已繳」後 Notion 的下次繳費公式會前進到下一期，因此不會留在此區間。
    return !bill.paused && days >= 0 && days <= 3;
  });
}

function formatBill(bill, today) {
  const days = daysBetween(today, bill.dueDate);
  const label = days === 0 ? '今天到期' : `${days} 天後到期`;
  const price = Number.isFinite(bill.price) ? `・$${bill.price.toLocaleString('en-US')}` : '';
  return `💳 ${bill.name}（${label}）${price}`;
}

function formatEvent(event) {
  const title = String(event.summary || '未命名行程').trim();
  return `• ${eventTimeRange(event)} ${title}`;
}

function buildMorningMessage({ today, events = [], bills = [] }) {
  if (!events.length && !bills.length) return null;
  const date = new Date(`${today}T00:00:00Z`);
  const weekday = '日一二三四五六'[date.getUTCDay()];
  const lines = [`☀️ 早安｜${date.getUTCMonth() + 1}/${date.getUTCDate()}（${weekday}）`];

  lines.push('', '📅 今日行程');
  lines.push(...(events.length ? events.map(formatEvent) : ['今天沒有行程']));

  if (bills.length) {
    lines.push('', '🔔 待繳提醒（3 天內）');
    lines.push(...bills.map((bill) => formatBill(bill, today)));
  }
  return lines.join('\n');
}

async function createMorningMessage({ notion, config, now = new Date(), calendarClient }) {
  const today = taipeiDate(now);
  const calendar = calendarClient || createCalendarClient(config);
  const [events, bills] = await Promise.all([
    calendar.listEvents(today, addDays(today, 1)),
    getUpcomingBills(notion, config.billDbId, today),
  ]);
  return buildMorningMessage({ today, events, bills });
}

async function pushLine(message, config, fetchImpl = fetch) {
  const userIds = config.lineUserIds || [];
  const results = await Promise.all(userIds.map(async (to) => {
    const response = await fetchImpl('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.lineToken}` },
      body: JSON.stringify({ to, messages: [{ type: 'text', text: message }] }),
    });
    if (!response.ok) throw new Error(`LINE Push API ${response.status}: ${await response.text().catch(() => '')}`);
    return to;
  }));
  return results.length;
}

module.exports = {
  taipeiDate, getUpcomingBills, buildMorningMessage, createMorningMessage, pushLine,
};
