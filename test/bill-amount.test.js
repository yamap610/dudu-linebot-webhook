const test = require('node:test');
const assert = require('node:assert/strict');
const bot = require('../lib/bot');

test('繳費選單可選擇帳單並預填更新金額指令', () => {
  const item = {
    id: 'a90447cd77218293b11b81d4fda86c3d', name: '電信費_台灣大哥大', price: 999,
    dueDate: '2026-07-20', amountUpdatedDate: '2026-07-18', paused: false,
  };
  const billsJson = JSON.stringify(bot.billsMessage([item]));
  assert.match(billsJson, /update_amount_menu/);
  assert.match(billsJson, /\$999（07\/18更新）/);
  assert.match(billsJson, /"label":"繳費"/);
  const menuJson = JSON.stringify(bot.updateAmountMenuMessage([item]));
  assert.match(menuJson, /更新金額 電信費_台灣大哥大 /);
  assert.match(menuJson, /openKeyboard/);
});

test('固定金額不顯示更新日，未來到期日不顯示年份', () => {
  const json = JSON.stringify(bot.billsMessage([{
    id: 'a90447cd77218293b11b81d4fda86c3d', name: 'Netflix', price: 390,
    dueDate: '2026-10-05', amountUpdatedDate: '2026-07-18', paused: false,
  }], 'all', '2026-07-24'));
  assert.match(json, /📅 10\/05 \$390/);
  assert.doesNotMatch(json, /07\/18更新/);
  assert.doesNotMatch(json, /2026\/10\/05/);
});

test('預設只顯示本月與逾期項目，並可切換查看全部', () => {
  const items = [
    { id: '1', name: '逾期帳單', price: 100, dueDate: '2026-06-30', paused: false },
    { id: '2', name: '本月帳單', price: 200, dueDate: '2026-07-31', paused: false },
    { id: '3', name: '未來帳單', price: 300, dueDate: '2026-08-01', paused: false },
    { id: '4', name: '暫停帳單', price: 400, dueDate: '2026-07-20', paused: true },
  ];
  const monthly = JSON.stringify(bot.billsMessage(items, 'month', '2026-07-24'));
  assert.match(monthly, /本月繳費/);
  assert.match(monthly, /逾期帳單/);
  assert.match(monthly, /本月帳單/);
  assert.doesNotMatch(monthly, /未來帳單/);
  assert.doesNotMatch(monthly, /暫停帳單/);
  assert.match(monthly, /查看全部/);
  assert.match(monthly, /action=bills_all/);

  const all = JSON.stringify(bot.billsMessage(items, 'all', '2026-07-24'));
  assert.match(all, /未來帳單/);
  assert.match(all, /暫停帳單/);
  assert.match(all, /只看本月/);
});

test('更新金額會修改 Notion 價格並回覆更新日期', async () => {
  const pageId = 'a90447cd77218293b11b81d4fda86c3d';
  let updated;
  const notion = {
    queryAll: async () => [{
      id: pageId,
      last_edited_time: '2026-07-18T03:00:00.000Z',
      properties: {
        '名稱': { title: [{ plain_text: '台灣大哥大' }] },
        '下次繳費': { formula: { type: 'string', string: '2026-07-20' } },
        '價格': { number: 999 },
        '暫停訂閱': { checkbox: false },
        '準備取消': { checkbox: false },
      },
    }],
    updatePage: async (id, properties) => { updated = { id, properties }; },
  };
  const parsed = bot.parseTextCommand('更新金額 台灣大哥大 1,380');
  assert.deepEqual(parsed, { action: 'update_bill_amount', name: '台灣大哥大', amount: 1380 });
  const messages = await bot.handleCommand(parsed, notion, { billDbId: 'bill-db' });
  assert.equal(updated.id, pageId);
  assert.equal(updated.properties['價格'].number, 1380);
  assert.match(messages[0].text, /更新：\d{2}\/\d{2}/);
});

test('確認繳費時會顯示信用卡帳單期別與期限', async () => {
  const pageId = 'a90447cd77218293b11b81d4fda86c3d';
  const notion = { queryAll: async () => [{
    id: pageId,
    properties: {
      '名稱': { title: [{ plain_text: '信用卡費_聯邦' }] },
      '下次繳費': { formula: { type: 'string', string: '2026-11-01' } },
      '繳費週期': { select: { name: '月' } },
      '價格': { number: 30000 },
      '暫停訂閱': { checkbox: false },
      '準備取消': { checkbox: false },
    },
  }] };
  const [message] = await bot.handleCommand({
    action: 'paid_confirm', id: pageId, amount: '30000',
  }, notion, { billDbId: 'bill-db' });
  const json = JSON.stringify(message);
  assert.match(json, /10 月帳單（繳費期限 11\/1）/);
  assert.match(json, /是，登記此期已繳/);
  assert.match(json, /不是，選其他期別/);
  assert.match(json, /due=2026-11-01/);
});

test('登記已繳會按期別去重並寫入對應繳費期限', async () => {
  const pageId = 'a90447cd77218293b11b81d4fda86c3d';
  let created;
  const billPage = {
    id: pageId,
    properties: {
      '名稱': { title: [{ plain_text: '信用卡費_聯邦' }] },
      '下次繳費': { formula: { type: 'string', string: '2026-11-01' } },
      '繳費週期': { select: { name: '月' } },
      '價格': { number: 4000 },
      '暫停訂閱': { checkbox: false },
      '準備取消': { checkbox: false },
    },
  };
  const notion = {
    queryAll: async (dbId) => (dbId === 'bill-db' ? [billPage] : []),
    createPage: async (dbId, properties) => { created = { dbId, properties }; },
  };
  const result = await bot.markBillPaid(
    notion, { billDbId: 'bill-db', billHistoryDbId: 'history-db' },
    pageId, 30000, '2026-11-01', new Date('2026-10-29T12:00:00+08:00'),
  );
  assert.equal(created.properties['繳費日期'].date.start, '2026-10-29');
  assert.equal(created.properties['項目'].title[0].text.content, '信用卡費_聯邦');
  assert.equal(created.properties['對應繳費期限'].date.start, '2026-11-01');
  assert.equal(created.properties['帳期'].rich_text[0].text.content, '202610');
  assert.equal(created.properties['繳費金額'].number, 30000);
  assert.equal(result.billingPeriod, '202610');
  assert.equal(result.nextDueDate, '2026-12-01');
});

test('一般固定支出使用繳費期限當月作為帳期', async () => {
  const pageId = '406447cd772180cc86add689d4dd03ba';
  let created;
  const notion = {
    queryAll: async (dbId) => (dbId === 'bill-db' ? [{
      id: pageId,
      properties: {
        '名稱': { title: [{ plain_text: '嵐峰路房租' }] },
        '下次繳費': { formula: { type: 'string', string: '2026-10-30' } },
        '繳費週期': { select: { name: '月' } },
        '價格': { number: 18500 },
        '暫停訂閱': { checkbox: false },
        '準備取消': { checkbox: false },
      },
    }] : []),
    createPage: async (dbId, properties) => { created = { dbId, properties }; },
  };
  await bot.markBillPaid(
    notion, { billDbId: 'bill-db', billHistoryDbId: 'history-db' },
    pageId, 18500, '2026-10-30', new Date('2026-10-26T12:00:00+08:00'),
  );
  assert.equal(created.properties['帳期'].rich_text[0].text.content, '202610');
});
