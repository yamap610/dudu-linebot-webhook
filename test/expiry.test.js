const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getExpiryItems, expiryCountdown, formatExpiryBlock,
} = require('../lib/expiry');
const { parseTextCommand, handleCommand } = require('../lib/bot');

function expiry(name, dueDate, handled = false, dateType = 'date') {
  const dueProperty = dateType === 'formula'
    ? { type: 'formula', formula: { type: 'date', date: { start: dueDate } } }
    : { type: 'date', date: { start: dueDate } };
  return { id: name, properties: {
    品項: { type: 'title', title: [{ plain_text: name }] },
    到期更換日: dueProperty,
    已處理: { type: 'checkbox', checkbox: handled },
  } };
}

test('效期只保留未處理的已過期與未來 3 天，並依日期排序', async () => {
  let receivedQuery;
  const notion = { queryAll: async (dbId, query) => {
    assert.equal(dbId, 'expiry-db');
    receivedQuery = query;
    return [
      expiry('起司', '2026-07-17'),
      expiry('豆腐', '2026-07-12'),
      expiry('牛奶', '2026-07-14', false, 'formula'),
      expiry('優格', '2026-07-15'),
      expiry('四天後', '2026-07-18'),
      expiry('已處理', '2026-07-13', true),
    ];
  } };

  const items = await getExpiryItems(notion, 'expiry-db', '2026-07-14');
  assert.deepEqual(items.map((item) => item.name), ['豆腐', '牛奶', '優格', '起司']);
  assert.deepEqual(items.map((item) => item.daysRemaining), [-2, 0, 1, 3]);
  assert.deepEqual(receivedQuery, {
    filter: { property: '已處理', checkbox: { equals: false } },
    sorts: [{ property: '到期更換日', direction: 'ascending' }],
  });
});

test('效期倒數與區塊符合 LINE 文字格式', () => {
  assert.equal(expiryCountdown(-2), '已過期 2 天');
  assert.equal(expiryCountdown(0), '今天到期');
  assert.equal(expiryCountdown(1), '剩 1 天');
  assert.equal(expiryCountdown(3), '剩 3 天');
  assert.equal(expiryCountdown(4), '');

  const block = formatExpiryBlock([
    { name: '豆腐', daysRemaining: -2 },
    { name: '牛奶', daysRemaining: 0 },
    { name: '優格', daysRemaining: 1 },
  ]);
  assert.equal(block,
    '【 效期管家 】\n\n'
    + '已過期\n'
    + '・豆腐｜已過期 2 天\n\n'
    + '3 天內\n'
    + '・牛奶｜今天到期\n'
    + '・優格｜剩 1 天');
  assert.doesNotMatch(block, /🔴|🟠|🟡|🔵/);
  assert.equal(formatExpiryBlock([]), '');
});

test('效期關鍵字可查全部注意品項或只查已過期', async () => {
  assert.deepEqual(parseTextCommand('效期'), { action: 'expiry', overdueOnly: false });
  assert.deepEqual(parseTextCommand('快過期'), { action: 'expiry', overdueOnly: false });
  assert.deepEqual(parseTextCommand('過期'), { action: 'expiry', overdueOnly: true });

  const notion = { queryAll: async () => [
    expiry('豆腐', '2020-01-01'),
    expiry('遙遠品項', '2099-01-01'),
  ] };
  const [message] = await handleCommand(
    { action: 'expiry', overdueOnly: true }, notion, { expiryDbId: 'expiry-db' },
  );
  assert.match(message.text, /^效期管家/);
  assert.match(message.text, /豆腐｜已過期/);
  assert.doesNotMatch(message.text, /3 天內|遙遠品項/);
});

test('手動查詢沒有結果時回覆空狀態', async () => {
  const notion = { queryAll: async () => [] };
  const [message] = await handleCommand(
    { action: 'expiry', overdueOnly: false }, notion, { expiryDbId: 'expiry-db' },
  );
  assert.equal(message.text, '目前沒有需要注意的效期品項。');
});
