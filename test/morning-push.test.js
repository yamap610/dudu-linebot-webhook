const test = require('node:test');
const assert = require('node:assert/strict');
const { getUpcomingBills, buildMorningMessage } = require('../lib/morning-push');

function bill(name, dueDate, price = 100, paused = false) {
  return { properties: {
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
