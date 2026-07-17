const { createCalendarClient, addDays, eventTimeRange } = require('./calendar');

const TW_OFFSET_MS = 8 * 60 * 60 * 1000;

const CALENDAR_LABELS = [
  { names: ['🌸 由依活動', '由依活動'], icon: '🌸', short: '由依', colorId: '2' },
  { names: ['🐴 馬丁活動', '馬丁活動'], icon: '🐴', short: '馬丁' },
  { names: ['🐰 嘟嘟家親子活動', '嘟嘟家親子活動'], icon: '🐰', short: '親子', colorId: '4' },
  { names: ['👣 家人行程/活動', '家人行程/活動'], icon: '👣', short: '家庭', colorId: '5' },
  { names: ['🏥 就醫/看診', '就醫/看診'], icon: '🏥', short: '看診', colorId: '11' },
  { names: ['💳 費用繳納', '費用繳納'], icon: '💳', short: '繳費' },
];
const LOCATION_LABELS = { '📍 回桃園': '回桃園', 回桃園: '回桃園', '📍 回宜蘭': '回宜蘭', 回宜蘭: '回宜蘭' };
const LOCATION_COLORS = { 6: '回桃園', 1: '回宜蘭' };
const WEATHER_LOCATIONS = {
  台北: [25.0330, 121.5654], 桃園: [24.9937, 121.3010], 宜蘭: [24.7021, 121.7378],
};

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

function dateProperty(property) {
  return String(property?.date?.start || '').slice(0, 10);
}

function selectProperty(property) {
  return String(property?.select?.name || '').trim();
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
      id: page.id,
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

function shouldRemindTodo(priority, dueDate, today) {
  if (!dueDate) return priority === '急';
  const days = daysBetween(today, dueDate);
  if (priority === '急') return [3, 1, 0].includes(days);
  if (priority === '中') return [1, 0].includes(days);
  if (priority === '緩') return days === 0;
  return false;
}

async function getTodoReminders(notion, todoDbId, today) {
  const pages = await notion.queryAll(todoDbId, {
    filter: { property: '完成', checkbox: { equals: false } },
    sorts: [{ property: '預定作業日期', direction: 'ascending' }],
  });
  return pages.map((page) => {
    const properties = page.properties || {};
    return {
      id: page.id,
      name: propertyTitle(properties),
      type: selectProperty(properties['屬性']),
      priority: selectProperty(properties['優先級']),
      dueDate: dateProperty(properties['預定作業日期']),
    };
  }).filter((item) => shouldRemindTodo(item.priority, item.dueDate, today));
}

function formatTodo(item, today) {
  const icon = item.type.includes('待買') ? '🛒' : '✅';
  const priority = item.priority === '急' ? '🔥' : item.priority === '緩' ? '🌿' : '⭐';
  if (!item.dueDate) return `${icon} ${priority} ${item.name}（未設定日期）`;
  const days = daysBetween(today, item.dueDate);
  const label = days === 0 ? '今天' : days === 1 ? '明天' : `${days} 天後`;
  return `${icon} ${priority} ${item.name}（${label}）`;
}

function formatBill(bill, today) {
  const days = daysBetween(today, bill.dueDate);
  const label = days === 0 ? '今天到期' : `${days} 天後到期`;
  const price = Number.isFinite(bill.price) ? ` $${bill.price.toLocaleString('en-US')}` : '';
  return `💳 ${bill.name}（${label}）${price}`;
}

function eventDefinition(event) {
  const label = String(event.eventLabelName || '').trim();
  const colorId = String(event.colorId || '');
  const title = String(event.summary || '未命名行程').trim();
  return CALENDAR_LABELS.find((item) => item.names.includes(label))
    || CALENDAR_LABELS.find((item) => item.colorId && item.colorId === colorId)
    || (title.startsWith('🏀') || title.includes('籃球') ? { icon: '🐴', short: '馬丁' } : null)
    || (title.includes('由依') || title.includes('Yui') ? { icon: '🌸', short: '由依' } : null)
    || (title.startsWith('💸') || ['信用卡費', '健保費', '繳費', '費用繳納'].some((word) => title.includes(word))
      ? { icon: '💳', short: '繳費' } : { icon: '🗓️', short: '其他' });
}

function calendarSections(events) {
  const locations = [];
  const activities = [];
  for (const event of events) {
    const title = String(event.summary || '未命名行程').trim();
    const label = String(event.eventLabelName || '').trim();
    const colorId = String(event.colorId || '');
    const titleLocation = ['回桃園', '回宜蘭'].find((place) => title.startsWith(place));
    const location = LOCATION_LABELS[label] || LOCATION_COLORS[colorId];
    if ((location && title.startsWith(location)) || (!label && titleLocation)) {
      const place = location || titleLocation;
      if (!locations.includes(place)) locations.push(place);
      continue;
    }
    const item = location ? { icon: '📍', short: location.replace('回', '') } : eventDefinition(event);
    const displayTitle = title.replace(/^(🏀|💸)\s*/, '');
    activities.push(`${item.icon} ${item.short}｜${eventTimeRange(event)} ${displayTitle}`);
  }
  return { locations, activities };
}

async function getWeather(locationName, fetchImpl = fetch) {
  const [latitude, longitude] = WEATHER_LOCATIONS[locationName] || WEATHER_LOCATIONS.台北;
  try {
    const params = new URLSearchParams({
      latitude, longitude,
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      timezone: 'Asia/Taipei', forecast_days: '1',
    });
    const response = await fetchImpl(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!response.ok) return null;
    const daily = (await response.json()).daily;
    const low = Math.round(daily.temperature_2m_min[0]);
    const high = Math.round(daily.temperature_2m_max[0]);
    const rain = Math.round(daily.precipitation_probability_max[0]);
    const code = daily.weather_code[0];
    const summary = rain >= 30 ? `降雨 ${rain}%` : code === 0 ? '晴朗'
      : [1, 2, 3].includes(code) ? '多雲' : [45, 48].includes(code) ? '有霧'
        : [95, 96, 99].includes(code) ? '雷雨' : '偶有陣雨';
    const reminder = rain >= 40 ? '☂️ 今天容易下雨，出門記得帶傘喔！'
      : high >= 33 ? '💧 氣溫偏高，外出記得補充水分～'
        : low <= 15 ? '🧥 天氣偏涼，外出記得多帶件外套～' : null;
    return { line: `${locationName} ${low}–${high}°C｜${summary}`, reminder };
  } catch { return null; }
}

function buildMorningMessage({ today, events = [], bills = [], todos = [], weather = null }) {
  if (!events.length && !bills.length && !todos.length) return null;
  const date = new Date(`${today}T00:00:00Z`);
  const weekday = '日一二三四五六'[date.getUTCDay()];
  const { locations, activities } = calendarSections(events);
  const lines = [`📢 今日小叮嚀｜${date.getUTCMonth() + 1}/${date.getUTCDate()}（${weekday}）`];

  if (weather?.line) lines.push('', weather.line, ...(weather.reminder ? [weather.reminder] : []));
  lines.push('', '【 行程 】');
  lines.push(...locations.map((location) => `📍 ${location}`));
  lines.push(...(activities.length ? activities : ['今天沒有行程']));

  if (bills.length) {
    lines.push('', '【 待繳提醒｜3 天內 】');
    lines.push(...bills.map((bill) => formatBill(bill, today)));
  }
  if (todos.length) {
    lines.push('', '【 待辦／待買提醒 】');
    lines.push(...todos.map((item) => formatTodo(item, today)));
  }
  return lines.join('\n');
}

async function createMorningMessage({ notion, config, now = new Date(), calendarClient, weatherData }) {
  const today = taipeiDate(now);
  const calendar = calendarClient || createCalendarClient(config);
  const [events, bills, todos] = await Promise.all([
    calendar.listEvents(today, addDays(today, 1)),
    getUpcomingBills(notion, config.billDbId, today),
    getTodoReminders(notion, config.todoDbId, today),
  ]);
  const { locations } = calendarSections(events);
  const weatherLocation = locations[0]?.replace('回', '') || '台北';
  const weather = weatherData === undefined ? await getWeather(weatherLocation) : weatherData;
  const text = buildMorningMessage({ today, events, bills, todos, weather });
  if (!text) return null;
  const quickItems = bills.filter((bill) => bill.id).slice(0, 13).map((bill) => ({
    type: 'action',
    action: {
      type: 'postback',
      label: `登記已繳｜${bill.name}`.slice(0, 20),
      data: `action=paid_amount&id=${bill.id}`,
      displayText: `登記已繳｜${bill.name}`,
    },
  }));
  return {
    type: 'text', text,
    ...(quickItems.length ? { quickReply: { items: quickItems } } : {}),
  };
}

async function pushLine(message, config, fetchImpl = fetch) {
  const userIds = config.lineUserIds || [];
  const results = await Promise.all(userIds.map(async (to) => {
    const response = await fetchImpl('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.lineToken}` },
      body: JSON.stringify({
        to,
        messages: [typeof message === 'string' ? { type: 'text', text: message } : message],
      }),
    });
    if (!response.ok) throw new Error(`LINE Push API ${response.status}: ${await response.text().catch(() => '')}`);
    return to;
  }));
  return results.length;
}

module.exports = {
  taipeiDate, getUpcomingBills, getTodoReminders, shouldRemindTodo,
  calendarSections, getWeather, buildMorningMessage, createMorningMessage, pushLine,
};
