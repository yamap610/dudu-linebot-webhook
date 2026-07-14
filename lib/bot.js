const DB_DEFAULTS = {
  wiki: '387447cd77218058b9afd44759ba10cc',
  todo: '30f447cd772183bf88d701bb9322384e',
  bill: 'a90447cd77218293b11b81d4fda86c3d',
  billHistory: 'c3b447cd772183c4a3e101bfc6880814',
};
const { createCalendarClient, addDays, weekRange, eventDate, eventTimeRange } = require('./calendar');

const TODO_TYPES = {
  todo: { label: '待辦事項', emoji: '✅', notion: '✅ 待辦事項', category: '📦 其他待辦' },
  buy: { label: '待買清單', emoji: '🛒', notion: '🛒 待買清單', category: '⚙️ 其他待買' },
};

const WIKI_CATEGORIES = [
  '🌱 育兒成長', '🏠 生活家務', '🛍️ 好物推薦', '📍餐廳景點',
  '✈️ 旅遊相關', '💻 AI / 數位工具', '📌 其他',
];

const CALENDAR_LABELS = [
  { names: ['🌸 由依活動', '由依活動'], emoji: '🌸', short: '由依', colorId: '2' },
  { names: ['🐴 馬丁活動', '馬丁活動'], emoji: '🐴', short: '馬丁', colorId: '' },
  { names: ['🐰 嘟嘟家親子活動', '嘟嘟家親子活動'], emoji: '🐰', short: '親子', colorId: '4' },
  { names: ['👣 家人行程/活動', '家人行程/活動'], emoji: '👣', short: '家庭', colorId: '5' },
  { names: ['🏥 就醫/看診', '就醫/看診'], emoji: '🏥', short: '看診', colorId: '11' },
  { names: ['💳 費用繳納', '費用繳納'], emoji: '💳', short: '繳費', colorId: '' },
];

function getConfig(env = process.env) {
  return {
    notionToken: env.NOTION_TOKEN,
    lineToken: env.LINE_TOKEN,
    channelSecret: env.LINE_CHANNEL_SECRET,
    wikiDbId: env.WIKI_DB_ID || DB_DEFAULTS.wiki,
    todoDbId: env.TODO_DB_ID || DB_DEFAULTS.todo,
    billDbId: env.BILL_DB_ID || DB_DEFAULTS.bill,
    billHistoryDbId: env.BILL_HISTORY_DB_ID || DB_DEFAULTS.billHistory,
    googleServiceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON,
    calendarId: env.CALENDAR_ID,
    googleCalendarUrl: env.GOOGLE_CALENDAR_URL || 'https://calendar.google.com/calendar/u/0/r',
    wikiNotionUrl: env.WIKI_NOTION_URL || `https://www.notion.so/${env.WIKI_DB_ID || DB_DEFAULTS.wiki}`,
  };
}

function validateConfig(config) {
  const missing = [];
  if (!config.notionToken) missing.push('NOTION_TOKEN');
  if (!config.lineToken) missing.push('LINE_TOKEN');
  if (!config.channelSecret) missing.push('LINE_CHANNEL_SECRET');
  if (missing.length) throw new Error(`缺少環境變數：${missing.join(', ')}`);
}

function createNotionClient(config, fetchImpl = fetch) {
  const headers = {
    Authorization: `Bearer ${config.notionToken}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28',
  };

  async function request(path, options = {}) {
    const response = await fetchImpl(`https://api.notion.com/v1${path}`, {
      ...options,
      headers: { ...headers, ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.object === 'error') {
      throw new Error(`Notion API：${data.message || response.statusText || response.status}`);
    }
    return data;
  }

  async function queryAll(dbId, query = {}, maxPages = 500) {
    const results = [];
    let cursor;
    do {
      const body = { ...query, page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const data = await request(`/databases/${dbId}/query`, {
        method: 'POST', body: JSON.stringify(body),
      });
      results.push(...(data.results || []));
      cursor = data.has_more && results.length < maxPages ? data.next_cursor : null;
    } while (cursor);
    return results.slice(0, maxPages);
  }

  return {
    queryAll,
    getPage: (pageId) => request(`/pages/${pageId}`),
    getBlockChildren: (blockId) => request(`/blocks/${blockId}/children?page_size=100`),
    updatePage: (pageId, properties) => request(`/pages/${pageId}`, {
      method: 'PATCH', body: JSON.stringify({ properties }),
    }),
    createPage: (databaseId, properties) => request('/pages', {
      method: 'POST',
      body: JSON.stringify({ parent: { database_id: databaseId }, properties }),
    }),
  };
}

function richText(prop) {
  if (!prop) return '';
  const items = prop.title || prop.rich_text || [];
  return items.map((item) => item.plain_text || item.text?.content || '').join('').trim();
}

function selectName(prop) {
  return prop?.select?.name || '';
}

function multiSelectNames(prop) {
  return (prop?.multi_select || []).map((item) => item.name);
}

function todoNote(properties = {}) {
  const candidates = ['備註', '筆記', '說明', '內容', '詳細內容'];
  for (const name of candidates) {
    const value = richText(properties[name]);
    if (value) return value;
  }
  return '';
}

function blockText(blocks = []) {
  const supported = [
    'paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item',
    'numbered_list_item', 'to_do', 'toggle', 'quote', 'callout', 'code',
  ];
  return blocks.map((block) => {
    const type = block?.type;
    if (!supported.includes(type)) return '';
    const text = (block[type]?.rich_text || []).map((item) => item.plain_text || item.text?.content || '').join('').trim();
    if (!text) return '';
    if (type === 'to_do') return `${block[type]?.checked ? '☑' : '☐'} ${text}`;
    if (type === 'bulleted_list_item') return `• ${text}`;
    if (type === 'numbered_list_item') return `・${text}`;
    return text;
  }).filter(Boolean).join('\n');
}

function formulaDate(prop) {
  const formula = prop?.formula || {};
  if (formula.type === 'date') return formula.date?.start?.slice(0, 10) || '';
  if (formula.type === 'string') {
    const match = (formula.string || '').match(/\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : '';
  }
  return '';
}

function normalizeId(id) {
  return String(id || '').replace(/-/g, '').toLowerCase();
}

function validPageId(id) {
  return /^[0-9a-f]{32}$/i.test(normalizeId(id));
}

function taipeiToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function daysFromToday(dateString, today = taipeiToday()) {
  const target = Date.parse(`${dateString}T00:00:00Z`);
  const base = Date.parse(`${today}T00:00:00Z`);
  return Math.round((target - base) / 86400000);
}

function money(value) {
  return Number.isFinite(value) && value > 0 ? `$${value.toLocaleString('zh-TW')}` : '';
}

function truncate(text, max = 100) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function textMessage(text, quickReply) {
  const message = { type: 'text', text };
  if (quickReply?.length) message.quickReply = { items: quickReply };
  return message;
}

function postbackAction(label, data, extra = {}) {
  return { type: 'postback', label, data, ...extra };
}

function quickPostback(label, data, extra = {}) {
  return { type: 'action', action: postbackAction(label, data, extra) };
}

function quickUri(label, uri) {
  return { type: 'action', action: { type: 'uri', label, uri } };
}

function button(label, data, style = 'secondary', extra = {}) {
  return {
    type: 'button',
    style,
    height: 'sm',
    ...(style === 'primary' ? { color: '#E8A0A8' } : {}),
    action: postbackAction(label, data, extra),
  };
}

function flexMessage(altText, bubble, quickReply) {
  const message = { type: 'flex', altText: truncate(altText, 400), contents: bubble };
  if (quickReply?.length) message.quickReply = { items: quickReply };
  return message;
}

function baseBubble(title, subtitle, contents, footer) {
  const bodyContents = [
    { type: 'text', text: title, weight: 'bold', size: 'xl', color: '#2F3E46' },
  ];
  if (subtitle) bodyContents.push({ type: 'text', text: subtitle, size: 'sm', color: '#6B7280', wrap: true, margin: 'sm' });
  bodyContents.push(...contents);
  const bubble = {
    type: 'bubble',
    styles: { footer: { separator: true } },
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: bodyContents },
  };
  if (footer?.length) bubble.footer = { type: 'box', layout: 'vertical', spacing: 'sm', contents: footer };
  return bubble;
}

function mainMenuMessage() {
  const actions = [
    button('💳 訂閱／待繳', 'action=bills', 'primary'),
    button('📚 搜尋小百科', 'action=wiki_menu'),
    button('📅 行程查詢', 'action=calendar_menu'),
    button('✅ 待辦事項', 'action=list&type=todo'),
    button('🛒 待買清單', 'action=list&type=buy'),
    button('➕ 快速新增', 'action=quick_add'),
  ];
  return flexMessage('嘟嘟一家選單', baseBubble(
    '嘟嘟一家 🐰', '想處理什麼呢？點按鈕就可以。', [], actions,
  ));
}

function mainQuickReplies() {
  return [
    quickPostback('🏠 主選單', 'action=menu'),
    quickPostback('✅ 待辦', 'action=list&type=todo'),
    quickPostback('🛒 待買', 'action=list&type=buy'),
    quickPostback('💳 繳費', 'action=bills'),
    quickPostback('📅 行程', 'action=calendar_menu'),
  ];
}

function calendarMenuMessage(config = {}) {
  return textMessage('📅 行程查詢\n想查看哪個時段？', [
    quickPostback('📆 本週行程', 'action=calendar_range&range=this_week'),
    quickPostback('⏭️ 下週行程', 'action=calendar_range&range=next_week'),
    quickPostback('🔎 指定日期', 'action=calendar_date', { type: 'datetimepicker', mode: 'date', initial: taipeiToday() }),
    { type: 'action', action: { type: 'uri', label: '🗓️ 開啟 Google 日曆', uri: config.googleCalendarUrl || 'https://calendar.google.com/calendar/u/0/r' } },
  ]);
}

function quickAddMessage() {
  return textMessage('➕ 快速新增\n請選擇要新增的內容：', [
    quickPostback('✅ 新增待辦', 'action=add_menu&type=todo'),
    quickPostback('🛒 新增待買', 'action=add_menu&type=buy'),
    quickPostback('📅 新增行程', 'action=calendar_add_menu'),
  ]);
}

function calendarLabelDefinition(labelName = '', colorId = '', title = '') {
  return CALENDAR_LABELS.find((item) => item.names.includes(labelName))
    || CALENDAR_LABELS.find((item) => item.colorId && item.colorId === String(colorId))
    || (title.startsWith('🏀') || title.includes('籃球') ? CALENDAR_LABELS[1] : null)
    || (title.includes('由依') || title.includes('Yui') ? CALENDAR_LABELS[0] : null)
    || (title.startsWith('💸') || ['信用卡費', '健保費', '繳費', '費用繳納'].some((word) => title.includes(word)) ? CALENDAR_LABELS[5] : null);
}

function calendarLabelText(labelName, colorId, title) {
  const item = calendarLabelDefinition(labelName, colorId, title);
  return item ? `${item.emoji} ${item.short}` : '🗓️ 其他';
}

function calendarAddMenuMessage(labels = []) {
  const actualNames = new Set(labels.map((label) => label.name));
  const options = CALENDAR_LABELS.map((item) => ({
    ...item,
    name: item.names.find((name) => actualNames.has(name)) || item.names[0],
  }));
  const quick = options.map((item) => quickPostback(
    `${item.emoji} ${item.short}`,
    `action=calendar_add_label&label=${encodeURIComponent(item.name)}`,
  ));
  quick.push(quickPostback('↩️ 回快速新增', 'action=quick_add'));
  return textMessage('📅 新增 Google 行程\n第 1 步／4：這是誰的行程或哪種類別？', quick);
}

function calendarStartMessage(labelName) {
  const label = calendarLabelText(labelName);
  return textMessage(`📅 新增行程｜${label}\n第 2 步／4：選擇開始時間，或新增整天行程。`, [
    quickPostback('🕘 選擇開始時間', `action=calendar_add_start&label=${encodeURIComponent(labelName)}`, { type: 'datetimepicker', mode: 'datetime', initial: `${taipeiToday()}T09:00` }),
    quickPostback('☀️ 整天行程', `action=calendar_add_day&label=${encodeURIComponent(labelName)}`, { type: 'datetimepicker', mode: 'date', initial: taipeiToday() }),
    quickPostback('↩️ 重選標籤', 'action=calendar_add_menu'),
  ]);
}

function addMinutes(dateTime, minutes) {
  const date = new Date(`${dateTime}:00+08:00`);
  date.setTime(date.getTime() + minutes * 60000);
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date).replace(' ', 'T');
}

function calendarEventsMessage(label, events) {
  if (!events.length) return textMessage(`📅 ${label}\n目前沒有行程。`, mainQuickReplies());
  const lines = events.slice(0, 30).map((event) => {
    const title = event.summary || '（未命名）';
    const owner = calendarLabelText(event.eventLabelName, event.colorId, title);
    const startTime = eventTimeRange(event).split('–')[0];
    const date = eventDate(event).slice(5).replace('-', '/');
    return startTime === '整天'
      ? `${date}｜${owner}｜${truncate(title, 50)}`
      : `${date} ${startTime}｜${owner}｜${truncate(title, 50)}`;
  });
  return textMessage(`📅 ${label}\n\n${lines.join('\n')}${events.length > 30 ? `\n\n另有 ${events.length - 30} 筆未顯示` : ''}`, mainQuickReplies());
}

function wikiMenuMessage() {
  const categories = WIKI_CATEGORIES.map((category) => quickPostback(
    truncate(category, 20), `action=wiki_category&value=${encodeURIComponent(category)}`,
  ));
  categories.unshift(quickPostback('🔎 輸入關鍵字', 'action=noop', {
    inputOption: 'openKeyboard', fillInText: '百科 ',
  }));
  categories.unshift(quickPostback('🆕 最近新增', 'action=wiki_recent'));
  categories.unshift(quickPostback('⭐ 精選常用', 'action=wiki_featured'));
  categories.push(quickUri('📖 前往 Notion 看全部', getConfig().wikiNotionUrl));
  categories.push(quickPostback('🏠 主選單', 'action=menu'));
  return textMessage('📚 小百科\n請選分類，或按「輸入關鍵字」搜尋名稱、摘要與筆記。', categories);
}

function addMenuMessage(type) {
  const meta = TODO_TYPES[type];
  const prefix = type === 'buy' ? '新增待買' : '新增待辦';
  const quick = ['急', '中', '緩'].map((priority) => quickPostback(
    `${priority === '急' ? '🔥' : priority === '中' ? '⭐' : '🌿'} ${priority}`,
    'action=noop', { inputOption: 'openKeyboard', fillInText: `${prefix} ${priority} ` },
  ));
  quick.push(quickPostback('↩️ 返回清單', `action=list&type=${type}`));
  return textMessage(`${meta.emoji} 新增${meta.label}\n先選優先級，再在已填好的文字後輸入項目名稱並送出。`, quick);
}

async function getTodoItems(notion, config, type) {
  const meta = TODO_TYPES[type];
  const pages = await notion.queryAll(config.todoDbId, {
    filter: { and: [
      { property: '完成', checkbox: { equals: false } },
      { property: '屬性', select: { equals: meta.notion } },
    ] },
    sorts: [{ property: '優先級', direction: 'ascending' }],
  });
  return pages.map((page) => ({
    id: normalizeId(page.id),
    name: richText(page.properties['項目名稱']) || '（無標題）',
    priority: selectName(page.properties['優先級']) || '中',
    category: selectName(page.properties['類別']),
    note: todoNote(page.properties),
    notionUrl: page.url || '',
  }));
}

function todoListMessage(type, items) {
  const meta = TODO_TYPES[type];
  const shown = items.slice(0, 10);
  const rows = shown.length ? shown.map((item, index) => ({
    type: 'box', layout: 'vertical', spacing: 'xs', margin: index === 0 ? 'xl' : 'sm',
    contents: [
      { type: 'text', text: `${item.priority === '急' ? '🔥' : item.priority === '緩' ? '🌿' : '⭐'} ${truncate(item.name, 38)}`, wrap: true, size: 'sm', weight: 'bold' },
      ...(item.note ? [{ type: 'text', text: `說明：${truncate(item.note, 70)}`, wrap: true, size: 'xs', color: '#6B7280' }] : []),
      { type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
        { type: 'button', style: 'link', height: 'sm', flex: 1, action: postbackAction('詳情', `action=todo_detail&type=${type}&id=${item.id}`) },
        { type: 'button', style: 'link', height: 'sm', flex: 1, action: postbackAction(type === 'buy' ? '已買到' : '完成', `action=complete_confirm&type=${type}&id=${item.id}`) },
      ] },
    ],
  })) : [{ type: 'text', text: '目前沒有未完成項目 🎉', color: '#6B7280', wrap: true }];
  const countText = items.length > 10 ? `共 ${items.length} 項，先顯示前 10 項` : `共 ${items.length} 項未完成`;
  rows.unshift({
    type: 'box', layout: 'vertical', margin: 'md', paddingAll: '10px', backgroundColor: '#F7F4EE', cornerRadius: 'md',
    contents: [
      { type: 'text', text: '優先級：🔥 急　⭐ 中　🌿 緩', size: 'xs', weight: 'bold', color: '#6B7280' },
    ],
  });
  const subtitle = countText;
  return flexMessage(`${meta.label}：${items.length} 項`, baseBubble(
    `${meta.emoji} ${meta.label}`, subtitle, rows,
    [button(`➕ 新增${type === 'buy' ? '待買' : '待辦'}`, `action=add_menu&type=${type}`, 'primary'), button('🔄 重新整理', `action=list&type=${type}`)],
  ), mainQuickReplies());
}

async function getTodoDetail(notion, pageId) {
  if (!validPageId(pageId)) throw new Error('無效的項目編號');
  if (typeof notion.getPage !== 'function') return null;
  const page = await notion.getPage(normalizeId(pageId));
  const props = page.properties || {};
  let note = todoNote(props);
  if (!note && typeof notion.getBlockChildren === 'function') {
    const data = await notion.getBlockChildren(normalizeId(pageId));
    note = blockText(data.results || []);
  }
  return {
    id: normalizeId(page.id || pageId),
    name: richText(props['項目名稱']) || '（無標題）',
    priority: selectName(props['優先級']) || '中',
    category: selectName(props['類別']),
    note,
    notionUrl: safeHttpUrl(page.url),
  };
}

function todoDetailMessage(type, item) {
  const meta = TODO_TYPES[type];
  if (!item) return textMessage('找不到這筆項目，可能已被刪除。', [quickPostback(`↩️ 返回${meta.label}`, `action=list&type=${type}`)]);
  const detail = [
    { type: 'text', text: `優先級：${item.priority === '急' ? '🔥 急' : item.priority === '緩' ? '🌿 緩' : '⭐ 中'}`, size: 'sm', color: '#6B7280', wrap: true },
    ...(item.category ? [{ type: 'text', text: `類別：${item.category}`, size: 'sm', color: '#6B7280', wrap: true }] : []),
    { type: 'text', text: item.note ? `📝 ${truncate(item.note, 600)}` : '📝 尚未填寫備註', size: 'sm', color: '#374151', wrap: true },
  ];
  const footer = [
    button(type === 'buy' ? '確認已買到' : '完成這項', `action=complete_confirm&type=${type}&id=${item.id}`, 'primary'),
    button('↩️ 返回清單', `action=list&type=${type}`),
  ];
  if (item.notionUrl) footer.push({ type: 'button', style: 'link', height: 'sm', action: { type: 'uri', label: '開啟 Notion', uri: item.notionUrl } });
  return flexMessage(`${meta.label}詳情`, baseBubble(`${meta.emoji} ${truncate(item.name, 60)}`, '', detail, footer));
}

async function addTodo(notion, config, type, priority, name) {
  const meta = TODO_TYPES[type];
  return notion.createPage(config.todoDbId, {
    '項目名稱': { title: [{ text: { content: name } }] },
    '屬性': { select: { name: meta.notion } },
    '完成': { checkbox: false },
    '優先級': { select: { name: priority } },
    '類別': { select: { name: meta.category } },
  });
}

async function completeTodo(notion, pageId) {
  if (!validPageId(pageId)) throw new Error('無效的項目編號');
  await notion.updatePage(normalizeId(pageId), { '完成': { checkbox: true } });
}

function confirmationMessage(title, detail, confirmData, cancelData, confirmLabel = '確認', cancelLabel = '取消') {
  return flexMessage(title, baseBubble(title, detail, [], [
    button(truncate(confirmLabel, 20), confirmData, 'primary'), button(truncate(cancelLabel, 20), cancelData),
  ]));
}

async function searchWiki(notion, config, { keyword, category, mode }) {
  const pages = await notion.queryAll(config.wikiDbId, {
    sorts: mode === 'recent'
      ? [{ timestamp: 'created_time', direction: 'descending' }]
      : [{ property: '精選', direction: 'descending' }, { timestamp: 'last_edited_time', direction: 'descending' }],
  });
  const needle = String(keyword || '').trim().toLocaleLowerCase('zh-TW');
  return pages.map((page) => {
    const props = page.properties;
    return {
      id: normalizeId(page.id),
      name: richText(props['名稱']) || '（無標題）',
      summary: richText(props['摘要']),
      note: richText(props['筆記']),
      tags: multiSelectNames(props['標籤']),
      categories: multiSelectNames(props['主分類']),
      audience: multiSelectNames(props['對象']),
      source: props['來源連結']?.url || '',
      notionUrl: page.url || '',
      featured: Boolean(props['精選']?.checkbox),
    };
  }).filter((item) => {
    if (mode === 'featured') return item.featured;
    if (mode === 'recent') return true;
    if (category) return item.categories.includes(category);
    if (!needle) return item.featured;
    return [item.name, item.summary, item.note, ...item.tags, ...item.categories, ...item.audience]
      .join(' ').toLocaleLowerCase('zh-TW').includes(needle);
  });
}

function safeHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
  } catch { return ''; }
}

function wikiResultsMessage(label, results) {
  const shown = results.slice(0, 5);
  if (!shown.length) {
    return textMessage(`📚 找不到「${truncate(label, 50)}」相關文章。\n可以換個關鍵字或改用分類找找看。`, [
      quickPostback('🔎 再搜尋', 'action=noop', { inputOption: 'openKeyboard', fillInText: '百科 ' }),
      quickUri('📖 前往 Notion 看全部', getConfig().wikiNotionUrl),
      quickPostback('📚 看分類', 'action=wiki_menu'), quickPostback('🏠 主選單', 'action=menu'),
    ]);
  }
  const cards = shown.map((item) => {
    const description = item.summary || item.note || '尚未填寫摘要';
    const source = safeHttpUrl(item.source) || safeHttpUrl(item.notionUrl);
    const footer = source ? [{ type: 'button', style: 'link', height: 'sm', action: { type: 'uri', label: '開啟來源', uri: source } }] : [];
    return baseBubble(
      `${item.featured ? '⭐ ' : ''}${truncate(item.name, 60)}`,
      truncate(item.categories.join('・'), 60),
      [
        { type: 'text', text: truncate(description, 260), wrap: true, size: 'sm', color: '#374151' },
        ...(item.tags.length ? [{ type: 'text', text: truncate(item.tags.map((tag) => `#${tag}`).join(' '), 100), wrap: true, size: 'xs', color: '#6B7280' }] : []),
      ], footer,
    );
  });
  return flexMessage(`小百科「${label}」找到 ${results.length} 篇`, {
    type: 'carousel', contents: cards,
  }, [
    quickPostback('🔎 再搜尋', 'action=noop', { inputOption: 'openKeyboard', fillInText: '百科 ' }),
    quickUri('📖 前往 Notion 看全部', getConfig().wikiNotionUrl),
    quickPostback('📚 看分類', 'action=wiki_menu'), quickPostback('🏠 主選單', 'action=menu'),
  ]);
}

async function getBills(notion, config) {
  const pages = await notion.queryAll(config.billDbId, {
    sorts: [{ property: '下次繳費', direction: 'ascending' }],
  });
  return pages.map((page) => ({
    id: normalizeId(page.id),
    name: richText(page.properties['名稱']) || '（無標題）',
    dueDate: formulaDate(page.properties['下次繳費']),
    price: page.properties['價格']?.number || 0,
    paused: Boolean(page.properties['暫停訂閱']?.checkbox),
    cancelling: Boolean(page.properties['準備取消']?.checkbox),
  })).filter((item) => item.dueDate || item.paused)
    .sort((a, b) => (a.paused - b.paused) || a.dueDate.localeCompare(b.dueDate));
}

function billStatus(item, today = taipeiToday()) {
  if (item.paused) return '⏸ 已暫停';
  const days = daysFromToday(item.dueDate, today);
  if (days < 0) return `⚠️ 逾期 ${Math.abs(days)} 天`;
  if (days === 0) return '🔔 今天到期';
  if (days <= 7) return `🔔 ${days} 天後到期`;
  return `📅 ${item.dueDate.replace(/-/g, '/')}`;
}

function billsMessage(items) {
  const active = items.filter((item) => !item.paused);
  const shown = [...active, ...items.filter((item) => item.paused)].slice(0, 10);
  const rows = shown.length ? shown.map((item) => {
    const contents = [
      { type: 'box', layout: 'vertical', flex: 4, contents: [
        { type: 'text', text: truncate(item.name, 38), weight: 'bold', size: 'sm', wrap: true },
        { type: 'text', text: `${billStatus(item)}${money(item.price) ? `・${money(item.price)}` : ''}${item.cancelling ? '・準備取消' : ''}`, size: 'xs', color: daysFromToday(item.dueDate || '9999-12-31') < 0 ? '#C2413B' : '#6B7280', wrap: true },
      ] },
      ...(item.paused ? [] : [{ type: 'button', style: 'link', height: 'sm', flex: 1, action: postbackAction('登記繳費', `action=paid_amount&id=${item.id}`) }]),
    ];
    return { type: 'box', layout: 'horizontal', alignItems: 'center', spacing: 'sm', contents };
  }) : [{ type: 'text', text: '目前沒有繳費項目 🎉', color: '#6B7280' }];
  const attention = active.filter((item) => daysFromToday(item.dueDate) <= 7).length;
  return flexMessage(`繳費狀態：${attention} 項需留意`, baseBubble(
    '💳 繳費狀態', attention ? `${attention} 項已到期或將在 7 天內到期` : '近期沒有需繳費項目', rows,
    [button('🔄 重新整理', 'action=bills', 'primary')],
  ), mainQuickReplies());
}

async function findBill(notion, config, pageId) {
  const bills = await getBills(notion, config);
  return bills.find((item) => item.id === normalizeId(pageId));
}

async function findBillByName(notion, config, name) {
  const bills = await getBills(notion, config);
  return bills.find((item) => item.name === String(name || '').trim());
}

function validAmount(value) {
  const amount = Number(String(value || '').replace(/,/g, ''));
  return Number.isFinite(amount) && amount > 0 && amount <= 100000000 ? Math.round(amount * 100) / 100 : 0;
}

function paidAmountMessage(bill) {
  const original = validAmount(bill.price);
  const safeName = truncate(bill.name.replace(/｜/g, ' '), 60);
  return flexMessage('輸入本次繳費金額', baseBubble(
    '💰 本次實付金額',
    `${bill.name}\n原定金額：${money(original) || '未設定'}`,
    [],
    [
      ...(original ? [button(`使用原金額 ${money(original)}`, `action=paid_confirm&id=${bill.id}&amount=${original}`, 'primary')] : []),
      button('輸入其他金額', 'action=noop', original ? 'secondary' : 'primary', {
        inputOption: 'openKeyboard', fillInText: `${safeName}｜本次金額：`,
      }),
      button('↩️ 返回待繳清單', 'action=bills'),
    ],
  ));
}

async function markBillPaid(notion, config, pageId, amount, now = new Date()) {
  if (!validPageId(pageId)) throw new Error('無效的繳費項目編號');
  const bill = await findBill(notion, config, pageId);
  if (!bill) throw new Error('找不到這筆繳費項目');
  const today = taipeiToday(now);
  const existing = await notion.queryAll(config.billHistoryDbId, {
    filter: { and: [
      { property: '產品', relation: { contains: normalizeId(pageId) } },
      { property: '繳費日期', date: { equals: today } },
    ] },
  }, 1);
  if (existing.length) return { bill, duplicate: true };
  await notion.createPage(config.billHistoryDbId, {
    '名稱': { title: [{ text: { content: '✓' } }] },
    '產品': { relation: [{ id: normalizeId(pageId) }] },
    '繳費日期': { date: { start: today } },
    '繳費金額': { number: validAmount(amount) || validAmount(bill.price) },
  });
  return { bill, amount: validAmount(amount) || validAmount(bill.price), duplicate: false };
}

function parseTextCommand(text) {
  const value = String(text || '').trim();
  if (/^(選單|主選單|menu|幫助|help)$/i.test(value)) return { action: 'menu' };
  const add = value.match(/^新增(待辦|待買)\s+(急|中|緩)\s+(.+)$/s);
  if (add) return { action: 'add', type: add[1] === '待買' ? 'buy' : 'todo', priority: add[2], name: add[3].trim() };
  const wiki = value.match(/^(?:百科|小百科)(?:搜尋)?\s+(.+)$/s);
  if (wiki) return { action: 'wiki_search', keyword: wiki[1].trim() };
  if (/^(百科|小百科)$/.test(value)) return { action: 'wiki_menu' };
  const calendarAddDetailed = value.match(/^新增行程｜([^｜]+)｜([^｜]+)｜([^｜]+)｜(.+)$/s);
  if (calendarAddDetailed) return {
    action: 'calendar_add', start: calendarAddDetailed[1], end: calendarAddDetailed[2],
    label: calendarAddDetailed[3], name: calendarAddDetailed[4].trim(),
  };
  const calendarAdd = value.match(/^新增行程\s+(\d{4}-\d{2}-\d{2})\s+(全天|\d{2}:\d{2})\s+(.+)$/s);
  if (calendarAdd) return { action: 'calendar_add', date: calendarAdd[1], time: calendarAdd[2] === '全天' ? '' : calendarAdd[2], name: calendarAdd[3].trim() };
  const paidAmount = value.match(/^(.{1,60})｜本次金額：\s*(.+)$/s);
  if (paidAmount) return { action: 'paid_custom', name: paidAmount[1].trim(), amount: validAmount(paidAmount[2]) };
  if (value.includes('待買')) return { action: 'list', type: 'buy' };
  if (value.includes('待辦')) return { action: 'list', type: 'todo' };
  if (value.includes('繳費') || value.includes('待繳')) return { action: 'bills' };
  if (/^(行程|行程查詢|日曆)$/.test(value)) return { action: 'calendar_menu' };
  if (/^(快速新增|新增)$/.test(value)) return { action: 'quick_add' };
  return null;
}

function parsePostback(data) {
  const params = new URLSearchParams(String(data || ''));
  return Object.fromEntries(params.entries());
}

async function handleCommand(command, notion, config) {
  if (!command || command.action === 'noop') return [];
  if (command.action === 'menu') return [mainMenuMessage()];
  if (command.action === 'quick_add') return [quickAddMessage()];
  if (command.action === 'calendar_menu') return [calendarMenuMessage(config)];
  if (command.action === 'calendar_range' || command.action === 'calendar_date') {
    const calendar = createCalendarClient(config);
    let start; let end; let label;
    if (command.action === 'calendar_date') {
      start = command.date; end = addDays(start, 1); label = start.replace(/-/g, '/');
    } else {
      const range = weekRange(taipeiToday(), command.range === 'next_week' ? 1 : 0);
      start = range.start; end = range.end; label = command.range === 'next_week' ? '下週行程' : '本週行程';
    }
    return [calendarEventsMessage(label, await calendar.listEvents(start, end))];
  }
  if (command.action === 'calendar_add_menu') {
    const calendar = createCalendarClient(config);
    return [calendarAddMenuMessage(await calendar.getLabels().catch(() => []))];
  }
  if (command.action === 'calendar_add_label') return [calendarStartMessage(command.label)];
  if (command.action === 'calendar_add_start') {
    const start = String(command.datetime || '').slice(0, 16);
    const initialEnd = start ? addMinutes(start, 60) : `${taipeiToday()}T10:00`;
    return [textMessage(`📅 新增行程｜${calendarLabelText(command.label)}\n第 3 步／4：選擇結束時間。\n開始：${start.replace('T', ' ')}`, [
      quickPostback('🕙 選擇結束時間', `action=calendar_add_end&label=${encodeURIComponent(command.label)}&start=${encodeURIComponent(start)}`, { type: 'datetimepicker', mode: 'datetime', initial: initialEnd }),
      quickPostback('↩️ 重選開始時間', `action=calendar_add_label&label=${encodeURIComponent(command.label)}`),
    ])];
  }
  if (command.action === 'calendar_add_end') {
    const end = String(command.datetime || '').slice(0, 16);
    const start = String(command.start || '').slice(0, 16);
    if (!start || !end || Date.parse(`${end}:00+08:00`) <= Date.parse(`${start}:00+08:00`)) {
      return [textMessage('⚠️ 結束時間必須晚於開始時間，請重新選擇。', [
        quickPostback('↩️ 重選開始時間', `action=calendar_add_label&label=${encodeURIComponent(command.label)}`),
      ])];
    }
    const prefix = `新增行程｜${start}｜${end}｜${command.label}｜`;
    const startDate = start.slice(5, 10).replace('-', '/');
    const endDate = end.slice(5, 10).replace('-', '/');
    const compactRange = start.slice(0, 10) === end.slice(0, 10)
      ? `${startDate} ${start.slice(11)}–${end.slice(11)}`
      : `${startDate} ${start.slice(11)}–${endDate} ${end.slice(11)}`;
    return [textMessage(`📅 新增行程｜${calendarLabelText(command.label)}\n第 4 步／4：輸入行程名稱。\n${compactRange}`, [
      quickPostback('⌨️ 輸入行程名稱', 'action=noop', { inputOption: 'openKeyboard', fillInText: prefix }),
      quickPostback('取消', 'action=calendar_menu'),
    ])];
  }
  if (command.action === 'calendar_add_day') {
    const date = String(command.date || '').slice(0, 10);
    const prefix = `新增行程｜${date}｜全天｜${command.label}｜`;
    return [textMessage(`📅 新增整天行程｜${calendarLabelText(command.label)}\n第 4 步／4：輸入行程名稱。\n日期：${date}`, [
      quickPostback('⌨️ 輸入行程名稱', 'action=noop', { inputOption: 'openKeyboard', fillInText: prefix }),
      quickPostback('取消', 'action=calendar_menu'),
    ])];
  }
  if (command.action === 'calendar_add') {
    const name = truncate(command.name, 120);
    const detailed = Boolean(command.start && command.end && command.label);
    if (!name || (!detailed && !/^\d{4}-\d{2}-\d{2}$/.test(command.date))) return [calendarAddMenuMessage()];
    const allDay = command.end === '全天' || (!detailed && !command.time);
    const definition = calendarLabelDefinition(command.label);
    const calendar = createCalendarClient(config);
    await calendar.createEvent({
      title: name, date: command.date, time: command.time,
      start: command.start, end: allDay && command.start ? addDays(command.start, 1) : command.end,
      allDay, labelName: command.label, colorId: definition?.colorId,
    });
    const startDate = String(command.start || command.date).slice(5, 10).replace('-', '/');
    const when = detailed
      ? (allDay ? startDate : (command.start.slice(0, 10) === command.end.slice(0, 10)
        ? `${startDate} ${command.start.slice(11)}–${command.end.slice(11)}`
        : `${startDate} ${command.start.slice(11)}–${String(command.end || '').slice(5, 10).replace('-', '/')} ${command.end.slice(11)}`))
      : `${String(command.date || '').slice(5).replace('-', '/')} ${command.time || ''}`.trim();
    const owner = command.label ? `\n標籤：${calendarLabelText(command.label)}` : '';
    return [textMessage(`✅ 已新增行事曆\n${when}${owner}\n${name}`, [
      quickPostback('📅 查看行程', 'action=calendar_menu'), quickPostback('➕ 繼續新增', 'action=quick_add'),
    ])];
  }
  if (command.action === 'wiki_menu') return [wikiMenuMessage()];
  if (command.action === 'wiki_recent') return [wikiResultsMessage('最近新增', await searchWiki(notion, config, { mode: 'recent' }))];
  if (command.action === 'wiki_featured') return [wikiResultsMessage('精選常用', await searchWiki(notion, config, { mode: 'featured' }))];
  if (command.action === 'wiki_search') {
    if (!command.keyword) return [wikiMenuMessage()];
    return [wikiResultsMessage(command.keyword, await searchWiki(notion, config, { keyword: command.keyword }))];
  }
  if (command.action === 'wiki_category') {
    const category = command.value || '';
    return [wikiResultsMessage(category, await searchWiki(notion, config, { category }))];
  }
  if (command.action === 'list' && TODO_TYPES[command.type]) {
    return [todoListMessage(command.type, await getTodoItems(notion, config, command.type))];
  }
  if (command.action === 'todo_detail' && TODO_TYPES[command.type] && validPageId(command.id)) {
    return [todoDetailMessage(command.type, await getTodoDetail(notion, command.id))];
  }
  if (command.action === 'add_menu' && TODO_TYPES[command.type]) return [addMenuMessage(command.type)];
  if (command.action === 'add' && TODO_TYPES[command.type]) {
    const name = truncate(command.name, 120);
    if (!name) return [addMenuMessage(command.type)];
    await addTodo(notion, config, command.type, command.priority, name);
    const meta = TODO_TYPES[command.type];
    return [textMessage(`${meta.emoji} 已新增：${name}\n優先級：${command.priority}`, [
      quickPostback(`查看${meta.label}`, `action=list&type=${command.type}`), quickPostback('🏠 主選單', 'action=menu'),
    ])];
  }
  if (command.action === 'complete_confirm' && TODO_TYPES[command.type] && validPageId(command.id)) {
    const item = await getTodoDetail(notion, command.id);
    const actionName = command.type === 'buy' ? '確認已買到' : '確認完成待辦';
    const detail = item ? `「${item.name}」\n\n確認後會同步更新 Notion。` : '確認後會同步更新 Notion。';
    return [confirmationMessage(actionName, detail, `action=complete&type=${command.type}&id=${normalizeId(command.id)}`, `action=list&type=${command.type}`, command.type === 'buy' ? '確認已買到' : '確認完成', '取消')];
  }
  if (command.action === 'complete' && TODO_TYPES[command.type]) {
    await completeTodo(notion, command.id);
    return [textMessage('✅ 已標記完成，Notion 已同步更新。', [
      quickPostback('查看清單', `action=list&type=${command.type}`), quickPostback('🏠 主選單', 'action=menu'),
    ])];
  }
  if (command.action === 'bills') return [billsMessage(await getBills(notion, config))];
  if (command.action === 'paid_amount' && validPageId(command.id)) {
    const bill = await findBill(notion, config, command.id);
    if (!bill) throw new Error('找不到這筆繳費項目');
    return [paidAmountMessage(bill)];
  }
  if (command.action === 'paid_custom') {
    const bill = await findBillByName(notion, config, command.name);
    if (!bill) return [textMessage(`找不到「${truncate(command.name, 50)}」這筆繳費項目，請回清單重新選擇。`, [quickPostback('↩️ 返回待繳清單', 'action=bills')])];
    if (!validAmount(command.amount)) return [textMessage('金額格式不正確，請輸入大於 0 的數字。', [quickPostback('↩️ 返回待繳清單', 'action=bills')])];
    command = { action: 'paid_confirm', id: bill.id, amount: command.amount };
  }
  if (command.action === 'paid_confirm' && validPageId(command.id)) {
    const bill = await findBill(notion, config, command.id);
    if (!bill) throw new Error('找不到這筆繳費項目');
    const amount = validAmount(command.amount) || validAmount(bill.price);
    if (!amount) return [paidAmountMessage(bill)];
    return [confirmationMessage(
      '確認登記已繳',
      `${bill.name}\n繳費日期：${taipeiToday()}\n實付金額：${money(amount)}\n\n確認後會新增一筆 Notion 歷史開銷紀錄。`,
      `action=paid&id=${bill.id}&amount=${amount}`,
      `action=paid_amount&id=${bill.id}`,
      `確認已繳 ${money(amount)}`,
      '返回修改',
    )];
  }
  if (command.action === 'paid') {
    const result = await markBillPaid(notion, config, command.id, command.amount);
    const message = result.duplicate
      ? `ℹ️ ${result.bill.name} 今天已有繳費紀錄，未重複新增。`
      : `✅ ${result.bill.name} 已登記為已繳\n實付金額：${money(result.amount)}\nNotion 已同步更新。`;
    return [textMessage(message, [quickPostback('查看繳費狀態', 'action=bills'), quickPostback('🏠 主選單', 'action=menu')])];
  }
  return [mainMenuMessage()];
}

module.exports = {
  DB_DEFAULTS, TODO_TYPES, WIKI_CATEGORIES, CALENDAR_LABELS, getConfig, validateConfig, createNotionClient,
  richText, formulaDate, normalizeId, validPageId, taipeiToday, daysFromToday, validAmount, todoNote, blockText,
  truncate, parseTextCommand, parsePostback, mainMenuMessage, wikiMenuMessage,
  todoListMessage, todoDetailMessage, billsMessage, paidAmountMessage, calendarMenuMessage, calendarAddMenuMessage,
  calendarStartMessage, calendarLabelText, quickAddMessage, calendarEventsMessage,
  handleCommand, markBillPaid,
};
