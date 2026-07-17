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
