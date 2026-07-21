const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getUpcomingBills, getTodoReminders, shouldRemindTodo, buildMorningMessage, createMorningMessage,
} = require('../lib/morning-push');

function bill(name, dueDate, price = 100, paused = false, id = name) {
  return { id, properties: {
    名稱: { type: 'title', title: [{ plain_text: name }] },
    下次繳費: { formula: { type: 'string', string: dueDate } },
    價格: { number: price },
    暫停訂閱: { checkbox: paused },
  } };
}

test('待繳只包含今天至未來 3 天，排除已過期、較晚及暫停項目', async () => {
  const notion = { queryAll: async () => [
    bill('已過期', '2026-07-13'), bill('今天', '2026-07-14'),
    bill('三天內', '2026-07-17'), bill('第四天', '2026-07-18'),
    bill('已暫停', '2026-07-15', 100, true),
  ] };
  const result = await getUpcomingBills(notion, 'db', '2026-07-14');
  assert.deepEqual(result.map((item) => item.name), ['今天', '三天內']);
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

test('沒有行程與待繳時不推播', () => {
  assert.equal(buildMorningMessage({ today: '2026-07-14', events: [], bills: [] }), null);
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
  assert.match(message.text, /【 待繳提醒｜3 天內 】/);
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
