const { createCalendarClient, addDays, eventTimeRange } = require('./calendar');
const { getExpiryItems, formatExpiryBlock } = require('./expiry');

const TW_OFFSET_MS = 8 * 60 * 60 * 1000;

const CALENDAR_LABELS = [
  { names: ['🌸 由依活動', '由依活動'], icon: '🌸', short: '由依', colorId: '2' },
  { names: ['🐴 馬丁活動', '馬丁活動'], icon: '🐴', short: '馬丁' },
  { names: ['🐰 嘟嘟家親子活動', '嘟嘟家親子活動'], icon: '🐰', short: '親子', colorId: '4' },
  { names: ['👣 家人行程/活動', '家人行程/活動'], icon: '👣', short: '家庭', colorId: '5' },
  { names: ['🏥 就醫/看診', '就醫/看診'], icon: '🏥', short: '看診', colorId: '11' },
  { names: ['💳 費用繳納', '費用繳納'], icon: '💳', short: '繳費' },
  { names: ['⭐ 其他', '其他'], icon: '⭐', short: '其他' },
];
const LOCATION_LABELS = { '📍 回桃園': '回桃園', 回桃園: '回桃園', '📍 回宜蘭': '回宜蘭', 回宜蘭: '回宜蘭' };
const LOCATION_COLORS = { 6: '回桃園', 1: '回宜蘭' };
const WEATHER_LOCATIONS = {
  台北市: [25.0330, 121.5654], 桃園市: [24.9937, 121.3010], 宜蘭市: [24.7520, 121.7538],
};
const WEATHER_LOCATION_ALIASES = { 台北: '台北市', 桃園: '桃園市', 宜蘭: '宜蘭市' };

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

function checkboxProperty(property) {
  return Boolean(property?.checkbox);
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

const ANNIVERSARY_ICONS = {
  生日: '🎂',
  紀念日: '💞',
  節日: '🎉',
  其他: '⭐',
};

async function getAnniversaryReminders(notion, anniversaryDbId, targetDate) {
  if (!anniversaryDbId) return [];
  const pages = await notion.queryAll(anniversaryDbId, {
    filter: { property: 'Line Bot 提醒', checkbox: { equals: true } },
    sorts: [{ property: '日期', direction: 'ascending' }],
  });
  return pages.map((page) => {
    const properties = page.properties || {};
    return {
      name: propertyTitle(properties),
      date: dateProperty(properties['日期']),
      type: selectProperty(properties['類型']) || '其他',
      repeatsYearly: checkboxProperty(properties['每年重複']),
      lineReminder: checkboxProperty(properties['Line Bot 提醒']),
    };
  }).filter((item) => {
    if (!item.lineReminder || !item.date) return false;
    return item.repeatsYearly ? item.date.slice(5) === targetDate.slice(5) : item.date === targetDate;
  });
}

function formatAnniversary(item, targetDate) {
  const icon = ANNIVERSARY_ICONS[item.type] || ANNIVERSARY_ICONS.其他;
  const years = Number(targetDate.slice(0, 4)) - Number(item.date.slice(0, 4));
  let milestone = '';
  if (item.repeatsYearly && years > 0 && item.type === '生日') milestone = `（${years} 歲）`;
  else if (item.repeatsYearly && years > 0 && item.type === '紀念日') milestone = `（${years} 週年）`;
  return `${icon} ${item.name}${milestone}`;
}

function previousBillingDate(dueDate, billingCycle = '月') {
  const months = { 月: 1, 季: 3, 年: 12 }[billingCycle] || 1;
  const source = new Date(`${dueDate}T00:00:00Z`);
  const targetMonth = source.getUTCMonth() - months;
  const lastDay = new Date(Date.UTC(source.getUTCFullYear(), targetMonth + 1, 0)).getUTCDate();
  const target = new Date(Date.UTC(
    source.getUTCFullYear(), targetMonth, Math.min(source.getUTCDate(), lastDay),
  ));
  return target.toISOString().slice(0, 10);
}

async function hasPaymentInCurrentCycle(notion, billHistoryDbId, bill, today) {
  if (!billHistoryDbId || !bill.id || !bill.dueDate) return false;
  const cycleStart = addDays(previousBillingDate(bill.dueDate, bill.billingCycle), 1);
  const pages = await notion.queryAll(billHistoryDbId, {
    filter: { and: [
      { property: '產品', relation: { contains: bill.id } },
      { or: [
        { property: '對應繳費期限', date: { equals: bill.dueDate } },
        { and: [
          { property: '對應繳費期限', date: { is_empty: true } },
          { property: '繳費日期', date: { on_or_after: cycleStart } },
          { property: '繳費日期', date: { on_or_before: today } },
        ] },
      ] },
    ] },
    page_size: 1,
  }, 1);
  return pages.length > 0;
}

async function getUpcomingBills(notion, billConfig, today) {
  const config = typeof billConfig === 'string' ? { billDbId: billConfig } : billConfig;
  const pages = await notion.queryAll(config.billDbId, {
    sorts: [{ property: '下次繳費', direction: 'ascending' }],
  });
  const candidates = pages.map((page) => {
    const properties = page.properties || {};
    return {
      id: page.id,
      name: propertyTitle(properties),
      dueDate: formulaDate(properties['下次繳費']),
      billingCycle: selectProperty(properties['繳費週期']) || '月',
      price: numberProperty(properties),
      paused: Boolean(properties['暫停訂閱']?.checkbox),
    };
  }).filter((bill) => {
    const days = bill.dueDate ? daysBetween(today, bill.dueDate) : -1;
    // 先找出日期上需提醒的項目，再用歷史紀錄排除已提早繳清的本期帳單。
    return !bill.paused && Boolean(bill.dueDate) && days <= 3;
  });
  if (!config.billHistoryDbId || !candidates.length) return candidates;
  const paid = await Promise.all(candidates.map((bill) => (
    hasPaymentInCurrentCycle(notion, config.billHistoryDbId, bill, today)
  )));
  return candidates.filter((_, index) => !paid[index]);
}

function shouldRemindTodo(priority, dueDate, today) {
  if (!dueDate) return priority === '急';
  const days = daysBetween(today, dueDate);
  if (days < 0) return ['急', '中', '緩'].includes(priority);
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
  if (!item.dueDate) return `${icon} ${priority} ${item.name}`;
  const days = daysBetween(today, item.dueDate);
  const label = days < 0 ? `逾期 ${Math.abs(days)} 天` : days === 0 ? '今天' : days === 1 ? '明天' : `${days} 天後`;
  return `${icon} ${priority} ${item.name}（${label}）`;
}

function formatBill(bill, today) {
  const days = daysBetween(today, bill.dueDate);
  const label = days < 0 ? `逾期 ${Math.abs(days)} 天` : days === 0 ? '今天到期' : `${days} 天後到期`;
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

async function getWeather(locationName, fetchImpl = fetch, dayOffset = 0) {
  const displayName = WEATHER_LOCATION_ALIASES[locationName] || locationName;
  const [latitude, longitude] = WEATHER_LOCATIONS[displayName] || WEATHER_LOCATIONS.宜蘭市;
  try {
    const params = new URLSearchParams({
      latitude, longitude,
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      timezone: 'Asia/Taipei', forecast_days: String(dayOffset + 1),
    });
    const response = await fetchImpl(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!response.ok) return null;
    const daily = (await response.json()).daily;
    const low = Math.round(daily.temperature_2m_min[dayOffset]);
    const high = Math.round(daily.temperature_2m_max[dayOffset]);
    const rain = Math.round(daily.precipitation_probability_max[dayOffset]);
    const code = daily.weather_code[dayOffset];
    const summary = rain >= 30 ? `降雨 ${rain}%` : code === 0 ? '晴朗'
      : [1, 2, 3].includes(code) ? '多雲' : [45, 48].includes(code) ? '有霧'
        : [95, 96, 99].includes(code) ? '雷雨' : '偶有陣雨';
    const when = dayOffset ? '明天' : '今天';
    const reminder = rain >= 40 ? `☂️ ${when}容易下雨，出門記得帶傘喔！`
      : high >= 33 ? '💧 氣溫偏高，外出記得補充水分～'
        : low <= 15 ? '🧥 天氣偏涼，外出記得多帶件外套～' : null;
    return { line: `${displayName} ${low}–${high}°C｜${summary}`, reminder };
  } catch { return null; }
}

function buildMorningMessage({
  today, labelDate = today, events = [], bills = [], todos = [], expiries = [], anniversaries = [], weather = null,
  heading = '今日小叮嚀',
}) {
  if (!events.length && !bills.length && !todos.length && !expiries.length && !anniversaries.length) return null;
  const date = new Date(`${today}T00:00:00Z`);
  const weekday = '日一二三四五六'[date.getUTCDay()];
  const { locations, activities } = calendarSections(events);
  const lines = [`📢 ${heading}｜${date.getUTCMonth() + 1}/${date.getUTCDate()}（${weekday}）`];

  const weatherLines = weather?.lines || (weather?.line ? [weather.line] : []);
  const weatherReminders = weather?.reminders || (weather?.reminder ? [weather.reminder] : []);
  if (weatherLines.length) lines.push('', ...weatherLines, ...weatherReminders);
  lines.push('', '【 行程 】');
  lines.push(...locations.map((location) => `📍 ${location}`));
  lines.push(...(activities.length ? activities : [heading === '明日小叮嚀' ? '明天沒有行程' : '今天沒有行程']));

  if (anniversaries.length) {
    lines.push('', heading === '明日小叮嚀' ? '【 明日紀念日 】' : '【 今日紀念日 】');
    lines.push(...anniversaries.map((item) => formatAnniversary(item, today)));
  }

  if (bills.length) {
    lines.push('', '【 待繳提醒｜逾期／3 天內 】');
    lines.push(...bills.map((bill) => formatBill(bill, labelDate)));
  }
  if (todos.length) {
    lines.push('', '【 待辦／待買提醒 】');
    lines.push(...todos.map((item) => formatTodo(item, labelDate)));
  }
  const expiryBlock = formatExpiryBlock(expiries);
  if (expiryBlock) lines.push('', expiryBlock);
  return lines.join('\n');
}

async function createMorningMessage({ notion, config, now = new Date(), calendarClient, weatherData, dayOffset = 0 }) {
  const labelDate = taipeiDate(now);
  const today = addDays(labelDate, dayOffset);
  const calendar = calendarClient || createCalendarClient(config);
  const [events, bills, todos, expiries, anniversaries] = await Promise.all([
    calendar.listEvents(today, addDays(today, 1)),
    getUpcomingBills(notion, config, today),
    getTodoReminders(notion, config.todoDbId, today),
    dayOffset === 0 ? getExpiryItems(notion, config.expiryDbId, today) : Promise.resolve([]),
    getAnniversaryReminders(notion, config.anniversaryDbId, today),
  ]);
  let weather = weatherData;
  if (weatherData === undefined) {
    const forecasts = (await Promise.all([
      getWeather('宜蘭市', fetch, dayOffset),
      getWeather('台北市', fetch, dayOffset),
    ])).filter(Boolean);
    weather = {
      lines: forecasts.map((forecast) => forecast.line),
      reminders: [...new Set(forecasts.map((forecast) => forecast.reminder).filter(Boolean))],
    };
  }
  const text = buildMorningMessage({
    today, labelDate, events, bills, todos, expiries, anniversaries, weather,
    heading: dayOffset ? '明日小叮嚀' : '今日小叮嚀',
  });
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
  taipeiDate, previousBillingDate, hasPaymentInCurrentCycle, getUpcomingBills, getTodoReminders, shouldRemindTodo,
  getAnniversaryReminders, formatAnniversary,
  getExpiryItems, formatExpiryBlock, calendarSections, getWeather, buildMorningMessage, createMorningMessage, pushLine,
};
