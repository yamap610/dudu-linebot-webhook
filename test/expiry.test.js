const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getExpiryItems, expiryCountdown, formatExpiryBlock, formatExpiryAll,
} = require('../lib/expiry');
const { parseTextCommand, handleCommand } = require('../lib/bot');

function expiry(name, dueDate, handled = false, dateType = 'date') {
  const dueProperty = dateType === 'formula'
    ? { type: 'formula', formula: { type: 'date', date: { start: dueDate } } }
    : { type: 'date', date: { start: dueDate } };
  return { id: name, properties: {
    品項: { type: 'title', title: [{ plain_text: name }] },
    日期: dueProperty,
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
    sorts: [{ property: '日期', direction: 'ascending' }],
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
    '【 效期提醒｜已過期／3 天內 】\n'
    + '⌛ 豆腐（已過期 2 天）\n'
    + '⌛ 牛奶（今天到期）\n'
    + '⌛ 優格（剩 1 天）');
  assert.doesNotMatch(block, /🔴|🟠|🟡|🔵/);
  assert.doesNotMatch(block, /・|已過期\n|3 天內\n/);
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
  const json = JSON.stringify(message);
  assert.equal(message.type, 'flex');
  assert.match(json, /⌛ 已過期/);
  assert.match(json, /豆腐/);
  assert.doesNotMatch(json, /遙遠品項/);
});

test('手動查詢沒有結果時回覆空狀態', async () => {
  const notion = { queryAll: async () => [] };
  const [message] = await handleCommand(
    { action: 'expiry', overdueOnly: false }, notion, { expiryDbId: 'expiry-db' },
  );
  const json = JSON.stringify(message);
  assert.equal(message.type, 'flex');
  assert.match(json, /目前沒有需要注意的效期品項/);
  assert.match(json, /查看全部/);
  assert.match(json, /僅看已過期/);
  assert.match(json, /重新整理/);
});

test('查看全部會顯示未處理品項，較遠日期改顯示實際日期', async () => {
  const notion = { queryAll: async () => [
    expiry('昆布鹽', '2026-09-16'),
    expiry('薑茶包', '2027-12-08'),
    expiry('已處理品項', '2026-09-15', true),
  ] };
  const items = await getExpiryItems(notion, 'expiry-db', '2026-09-15', { includeAll: true });
  assert.deepEqual(items.map((item) => item.name), ['昆布鹽', '薑茶包']);
  assert.equal(formatExpiryAll(items),
    '【 全部未處理效期 】\n'
    + '⌛ 昆布鹽（剩 1 天）\n'
    + '⌛ 薑茶包（2027/12/08）');

  const [message] = await handleCommand(
    { action: 'expiry_all' }, notion,
    { expiryDbId: 'expiry-db', expiryNotionUrl: 'https://app.notion.com/p/test' },
  );
  const json = JSON.stringify(message);
  assert.equal(message.type, 'flex');
  assert.match(json, /⌛ 全部效期/);
  assert.match(json, /昆布鹽/);
  assert.match(json, /薑茶包/);
  assert.match(json, /只看需注意/);
});
