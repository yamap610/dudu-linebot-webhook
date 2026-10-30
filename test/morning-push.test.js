const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getUpcomingBills, getTodoReminders, shouldRemindTodo, getAnniversaryReminders,
  buildMorningMessage, createMorningMessage,
} = require('../lib/morning-push');

function bill(name, dueDate, price = 100, paused = false, id = name) {
  return { id, properties: {
    名稱: { type: 'title', title: [{ plain_text: name }] },
    下次繳費: { formula: { type: 'string', string: dueDate } },
    價格: { number: price },
    繳費週期: { select: { name: '月' } },
    暫停訂閱: { checkbox: paused },
  } };
}

test('待繳包含逾期與未來 3 天，排除較晚及暫停項目', async () => {
  const notion = { queryAll: async () => [
    bill('已過期', '2026-07-13'), bill('今天', '2026-07-14'),
    bill('三天內', '2026-07-17'), bill('第四天', '2026-07-18'),
    bill('已暫停', '2026-07-15', 100, true),
  ] };
  const result = await getUpcomingBills(notion, 'db', '2026-07-14');
  assert.deepEqual(result.map((item) => item.name), ['已過期', '今天', '三天內']);
});

test('本期已提早繳費時不再發送待繳提醒', async () => {
  const calls = [];
  const notion = { queryAll: async (dbId, query) => {
    calls.push({ dbId, query });
    if (dbId === 'bill-db') return [bill('信用卡費_聯邦', '2026-11-01', 30000, false, 'federal-id')];
    if (dbId === 'history-db') return [{ id: 'payment-id' }];
    return [];
  } };
  const result = await getUpcomingBills(notion, {
    billDbId: 'bill-db', billHistoryDbId: 'history-db',
  }, '2026-10-30');
  assert.deepEqual(result, []);
  const historyQuery = calls.find((call) => call.dbId === 'history-db').query;
  assert.deepEqual(historyQuery.filter.and, [
    { property: '產品', relation: { contains: 'federal-id' } },
    { or: [
      { property: '對應繳費期限', date: { equals: '2026-11-01' } },
      { and: [
        { property: '對應繳費期限', date: { is_empty: true } },
        { property: '繳費日期', date: { on_or_after: '2026-10-02' } },
        { property: '繳費日期', date: { on_or_before: '2026-10-30' } },
      ] },
    ] },
  ]);
});

test('只有上期繳費紀錄時仍保留本期提醒', async () => {
  const notion = { queryAll: async (dbId) => (
    dbId === 'bill-db'
      ? [bill('信用卡費_聯邦', '2026-11-01', 30000, false, 'federal-id')]
      : []
  ) };
  const result = await getUpcomingBills(notion, {
    billDbId: 'bill-db', billHistoryDbId: 'history-db',
  }, '2026-10-30');
  assert.deepEqual(result.map((item) => item.name), ['信用卡費_聯邦']);
});

test('每日提醒會標示帳單逾期天數', () => {
  const message = buildMorningMessage({
    today: '2026-07-14',
    events: [],
    bills: [{ name: '電信費', dueDate: '2026-07-11', price: 1029 }],
  });
  assert.match(message, /待繳提醒｜逾期／3 天內/);
  assert.match(message, /💳 電信費（逾期 3 天） \$1,029/);
});

test('行程與待繳合併為一則早安訊息', () => {
  const message = buildMorningMessage({
    today: '2026-07-14',
    events: [{ summary: '看牙醫', start: { dateTime: '2026-07-14T09:00:00+08:00' }, end: { dateTime: '2026-07-14T10:00:00+08:00' } }],
    bills: [{ name: '網路費', dueDate: '2026-07-16', price: 999 }],
  });
  assert.match(message, /今日小叮嚀/);
  assert.match(message, /【 行程 】/);
  assert.match(message, /看牙醫/);
  assert.match(message, /待繳提醒/);
  assert.match(message, /🗓️ 其他｜09:00–10:00 看牙醫/);
  assert.match(message, /💳 網路費（2 天後到期） \$999/);
  assert.doesNotMatch(message, /•|・/);
  assert.doesNotMatch(message, /▪️/);
});

test('每日提醒同時顯示宜蘭市住家與台北市上班地天氣', () => {
  const message = buildMorningMessage({
    today: '2026-07-14',
    events: [{ summary: '上班', eventLabelName: '🐴 馬丁活動', start: { date: '2026-07-14' } }],
    weather: {
      lines: ['宜蘭市 25–31°C｜降雨 60%', '台北市 27–34°C｜多雲'],
      reminders: ['☂️ 今天容易下雨，出門記得帶傘喔！'],
    },
  });
  assert.match(message, /宜蘭市 25–31°C｜降雨 60%\n台北市 27–34°C｜多雲/);
  assert.equal((message.match(/出門記得帶傘/g) || []).length, 1);
});

test('月曆的其他標籤使用星號分類', () => {
  const message = buildMorningMessage({
    today: '2026-07-14',
    events: [{ summary: '整理照片', eventLabelName: '⭐ 其他', start: { date: '2026-07-14' } }],
  });
  assert.match(message, /⭐ 其他｜整天 整理照片/);
});

test('沒有行程與待繳時不推播', () => {
  assert.equal(buildMorningMessage({ today: '2026-07-14', events: [], bills: [] }), null);
});

test('紀念日依每年重複與 LINE 提醒開關篩選', async () => {
  const anniversary = (name, date, type, repeatsYearly = true, lineReminder = true) => ({ properties: {
    名稱: { type: 'title', title: [{ plain_text: name }] },
    日期: { date: { start: date } },
    類型: { select: { name: type } },
    每年重複: { checkbox: repeatsYearly },
    'Line Bot 提醒': { checkbox: lineReminder },
  } });
  const notion = { queryAll: async () => [
    anniversary('嘟嘟生日', '2024-09-18', '生日'),
    anniversary('結婚紀念日', '2023-09-18', '紀念日'),
    anniversary('一次活動', '2026-09-18', '其他', false),
    anniversary('不同日期', '2024-09-19', '生日'),
    anniversary('不要提醒', '2024-09-18', '生日', true, false),
  ] };
  const result = await getAnniversaryReminders(notion, 'anniversary-db', '2026-09-18');
  assert.deepEqual(result.map((item) => item.name), ['嘟嘟生日', '結婚紀念日', '一次活動']);

  const message = buildMorningMessage({ today: '2026-09-18', anniversaries: result });
  assert.match(message, /【 今日紀念日 】/);
  assert.match(message, /🎂 嘟嘟生日（2 歲）/);
  assert.match(message, /💞 結婚紀念日（3 週年）/);
  assert.match(message, /⭐ 一次活動/);
});

test('明日預告顯示明日紀念日', async () => {
  const notion = { queryAll: async (dbId) => (dbId === 'anniversary-db' ? [{ properties: {
    名稱: { type: 'title', title: [{ plain_text: '家庭日' }] },
    日期: { date: { start: '2020-07-19' } },
    類型: { select: { name: '紀念日' } },
    每年重複: { checkbox: true },
    'Line Bot 提醒': { checkbox: true },
  } }] : []) };
  const message = await createMorningMessage({
    notion,
    config: { anniversaryDbId: 'anniversary-db' },
    now: new Date('2026-07-18T13:00:00Z'),
    calendarClient: { listEvents: async () => [] },
    weatherData: null,
    dayOffset: 1,
  });
  assert.match(message.text, /【 明日紀念日 】/);
  assert.match(message.text, /💞 家庭日（6 週年）/);
});

test('每日提醒有資料才顯示效期、耗材與保固區塊', () => {
  const message = buildMorningMessage({
    today: '2026-07-14',
    expiries: [
      { name: '豆腐', daysRemaining: -2 },
      { name: '牛奶', daysRemaining: 0 },
      { name: '起司', daysRemaining: 3 },
      { name: '濾芯', daysRemaining: 5 },
    ],
  });
  assert.match(message, /【 效期／耗材／保固｜5 天內 】/);
  assert.match(message, /⌛ 豆腐（已過期 2 天）/);
  assert.match(message, /⌛ 牛奶（今天到期）\n⌛ 起司（剩 3 天）\n⌛ 濾芯（剩 5 天）/);
  assert.doesNotMatch(message, /・|已過期\n|5 天內\n/);

  const withoutExpiry = buildMorningMessage({
    today: '2026-07-14',
    events: [{ summary: '看牙醫', start: { date: '2026-07-14' }, end: { date: '2026-07-15' } }],
  });
  assert.doesNotMatch(withoutExpiry, /效期／耗材／保固|目前沒有需要注意的效期品項/);
});

test('待辦依優先級在指定日期提醒', () => {
  assert.equal(shouldRemindTodo('急', '2026-08-01', '2026-07-29'), true);
  assert.equal(shouldRemindTodo('急', '2026-08-01', '2026-07-30'), false);
  assert.equal(shouldRemindTodo('中', '2026-08-01', '2026-07-31'), true);
  assert.equal(shouldRemindTodo('緩', '2026-08-01', '2026-07-31'), false);
  assert.equal(shouldRemindTodo('緩', '2026-08-01', '2026-08-01'), true);
  assert.equal(shouldRemindTodo('急', '2026-08-01', '2026-08-02'), true);
  assert.equal(shouldRemindTodo('中', '2026-08-01', '2026-08-02'), true);
  assert.equal(shouldRemindTodo('緩', '2026-08-01', '2026-08-02'), true);
  assert.equal(shouldRemindTodo('急', '', '2026-08-01'), true);
  assert.equal(shouldRemindTodo('中', '', '2026-08-01'), false);
});

test('只取得未完成且今天需要提醒的待辦待買', async () => {
  const todo = (name, priority, date, type = '✅ 待辦事項') => ({ properties: {
    項目名稱: { type: 'title', title: [{ plain_text: name }] },
    屬性: { select: { name: type } },
    優先級: { select: { name: priority } },
    預定作業日期: { date: date ? { start: date } : null },
  } });
  const notion = { queryAll: async () => [
    todo('回桃園待辦', '急', '2026-08-01'),
    todo('一般待買', '中', '', '🛒 待買清單'),
    todo('明天要買', '中', '2026-07-30', '🛒 待買清單'),
  ] };
  const result = await getTodoReminders(notion, 'db', '2026-07-29');
  assert.deepEqual(result.map((item) => item.name), ['回桃園待辦', '明天要買']);
  const message = buildMorningMessage({ today: '2026-07-29', todos: result });
  assert.match(message, /待辦／待買提醒/);
  assert.match(message, /回桃園待辦（3 天後）/);
  assert.match(message, /明天要買（明天）/);
});

test('逾期未完成項目每天顯示逾期天數', async () => {
  const notion = { queryAll: async () => [{ properties: {
    項目名稱: { type: 'title', title: [{ plain_text: '整理行李' }] },
    屬性: { select: { name: '✅ 待辦事項' } },
    優先級: { select: { name: '中' } },
    預定作業日期: { date: { start: '2026-08-01' } },
  } }] };
  const todos = await getTodoReminders(notion, 'db', '2026-08-03');
  const message = buildMorningMessage({ today: '2026-08-03', todos });
  assert.match(message, /整理行李（逾期 2 天）/);
});

test('急件未設定日期時不顯示多餘文字', async () => {
  const notion = { queryAll: async () => [{ properties: {
    項目名稱: { type: 'title', title: [{ plain_text: '整理嬰兒用品' }] },
    屬性: { select: { name: '✅ 待辦事項' } },
    優先級: { select: { name: '急' } },
    預定作業日期: { date: null },
  } }] };
  const todos = await getTodoReminders(notion, 'db', '2026-07-19');
  const message = buildMorningMessage({ today: '2026-07-19', todos });
  assert.match(message, /✅ 🔥 整理嬰兒用品/);
  assert.doesNotMatch(message, /未設定日期/);
});

test('早晨待繳項目提供直接登記已繳按鈕', async () => {
  const notion = { queryAll: async () => [bill('網路費', '2026-07-16', 999, false, 'bill-page-id')] };
  const calendarClient = { listEvents: async () => [] };
  const message = await createMorningMessage({
    notion,
    config: { billDbId: 'db' },
    now: new Date('2026-07-14T01:00:00Z'),
    calendarClient,
    weatherData: null,
  });
  assert.equal(message.type, 'text');
  assert.deepEqual(message.quickReply.items[0].action, {
    type: 'postback',
    label: '登記已繳｜網路費',
    data: 'action=paid_amount&id=bill-page-id',
    displayText: '登記已繳｜網路費',
  });
});

test('21:00 預告以明天為基準合併行程、待繳與待辦', async () => {
  const todoPage = { properties: {
    項目名稱: { type: 'title', title: [{ plain_text: '回桃園待辦' }] },
    屬性: { select: { name: '✅ 待辦事項' } },
    優先級: { select: { name: '急' } },
    預定作業日期: { date: { start: '2026-07-19' } },
  } };
  const notion = { queryAll: async (dbId) => (dbId === 'todo-db'
    ? [todoPage]
    : [bill('信用卡費', '2026-07-20', 3500, false, 'bill-id')]) };
  const calendarClient = { listEvents: async (start, end) => {
    assert.equal(start, '2026-07-19');
    assert.equal(end, '2026-07-20');
    return [{ summary: '親子活動', start: { date: '2026-07-19' }, end: { date: '2026-07-20' } }];
  } };
  const message = await createMorningMessage({
    notion,
    config: { billDbId: 'bill-db', todoDbId: 'todo-db' },
    now: new Date('2026-07-18T13:00:00Z'),
    calendarClient,
    weatherData: { line: '台北 26–33°C｜降雨 100%', reminder: '☂️ 明天容易下雨，出門記得帶傘喔！' },
    dayOffset: 1,
  });
  assert.match(message.text, /明日小叮嚀｜7\/19/);
  assert.match(message.text, /【 行程 】/);
  assert.match(message.text, /【 待繳提醒｜逾期／3 天內 】/);
  assert.match(message.text, /信用卡費（2 天後到期）/);
  assert.match(message.text, /【 待辦／待買提醒 】/);
  assert.match(message.text, /回桃園待辦（明天）/);
});

test('21:00 預告沒有行程時顯示明天沒有行程', () => {
  const message = buildMorningMessage({
    today: '2026-07-22', labelDate: '2026-07-21', heading: '明日小叮嚀',
    todos: [{ name: '準備用品', type: '✅ 待辦事項', priority: '急', dueDate: '2026-07-22' }],
  });
  assert.match(message, /明天沒有行程/);
  assert.doesNotMatch(message, /今天沒有行程/);
});
