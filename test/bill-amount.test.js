const test = require('node:test');
const assert = require('node:assert/strict');
const bot = require('../lib/bot');

test('繳費清單只顯示內容並統一導向 App 管理', () => {
  const item = {
    id: 'a90447cd77218293b11b81d4fda86c3d', name: '電信費_台灣大哥大', price: 999,
    dueDate: '2026-07-20', amountPeriod: '202607', amountUpdatedDate: '2026-07-18', paused: false,
  };
  const billsJson = JSON.stringify(bot.billsMessage([item]));
  assert.match(billsJson, /\$999（202607）/);
  assert.doesNotMatch(billsJson, /\$999・/);
  assert.match(billsJson, /開啟 App 管理/);
  assert.match(billsJson, /my-secretary-fawn\.vercel\.app\/todo\?tab=p/);
  assert.doesNotMatch(billsJson, /update_amount_menu/);
  assert.doesNotMatch(billsJson, /"label":"繳費"/);
  assert.doesNotMatch(billsJson, /[?&]item=/);

  // 舊文字指令仍保留相容性，但不再出現在新的清單介面。
  const menuJson = JSON.stringify(bot.updateAmountMenuMessage([item]));
  assert.match(menuJson, /更新金額 電信費_台灣大哥大 /);
  assert.match(menuJson, /openKeyboard/);
});

test('累積帳單未達門檻時顯示累積中而不是催繳', () => {
  const json = JSON.stringify(bot.billsMessage([{
    id: 'fet', name: '電信費_遠傳', price: 841, dueDate: '', paused: false,
    accumulating: true, threshold: 1000,
  }], 'month', '2026-11-17'));
  assert.match(json, /🟡 累積中/);
  assert.match(json, /\$841／\$1,000/);
  assert.doesNotMatch(json, /今天到期|逾期/);
});

test('固定金額不顯示更新日，未來到期日不顯示年份', () => {
  const json = JSON.stringify(bot.billsMessage([{
    id: 'a90447cd77218293b11b81d4fda86c3d', name: 'Netflix', price: 390,
    dueDate: '2026-10-05', amountUpdatedDate: '2026-07-18', paused: false,
  }], 'all', '2026-07-24'));
  assert.match(json, /📅 10\/05 \$390/);
  assert.match(json, /（202610）/);
  assert.doesNotMatch(json, /07\/18更新/);
  assert.doesNotMatch(json, /2026\/10\/05/);
});

test('待繳清單以 YYYYMM 簡短顯示期別', () => {
  const items = [
    { id: '1', name: '信用卡費_聯邦', price: 30000, dueDate: '2026-12-01', amountPeriod: '202610', amountUpdatedDate: '2026-10-26', paused: false },
    { id: '2', name: '嵐峰路房租', price: 18500, dueDate: '2026-11-30', paused: false },
    { id: '3', name: '健保_由依分期', price: 829, dueDate: '2026-11-05', paused: false },
  ];
  const json = JSON.stringify(bot.billsMessage(items, 'all', '2026-10-30'));
  assert.match(json, /信用卡費_聯邦[\s\S]*\$30,000（202610）/);
  assert.match(json, /嵐峰路房租[\s\S]*（202611）/);
  assert.match(json, /健保_由依分期[\s\S]*（202611）/);
  assert.doesNotMatch(json, /10\/26更新/);
});

test('變動金額的下期帳單距離超過 30 天時不催更新也不能誤按繳費', () => {
  const json = JSON.stringify(bot.billsMessage([{
    id: '1', name: '信用卡費_星展', price: 7000,
    dueDate: '2026-12-09', amountPeriod: '202610', paused: false,
  }], 'all', '2026-11-05'));
  assert.match(json, /12\/09・下期尚未到更新時間/);
  assert.match(json, /上期金額：\$7,000（202610）/);
  assert.doesNotMatch(json, /金額待更新/);
  assert.doesNotMatch(json, /action=paid_amount&id=1/);
  assert.doesNotMatch(json, /12\/09 \$7,000/);
});

test('變動金額進入到期前 30 天會提示更新並統一導向 App', () => {
  const json = JSON.stringify(bot.billsMessage([{
    id: '1', name: '信用卡費_星展', price: 7000,
    dueDate: '2026-12-09', amountPeriod: '202610', paused: false,
  }], 'all', '2026-11-09'));
  assert.match(json, /12\/09 ⚠️ 金額待更新/);
  assert.match(json, /上期金額：\$7,000（202610）/);
  assert.match(json, /"type":"uri"/);
  assert.match(json, /my-secretary-fawn\.vercel\.app\/todo\?tab=p/);
  assert.doesNotMatch(json, /[?&]item=/);
  assert.doesNotMatch(json, /action=complete/);
});

test('舊訊息的繳費按鈕也不能提早新增下一期紀錄', async () => {
  const pageId = 'a90447cd77218293b11b81d4fda86c3d';
  let created = false;
  const notion = {
    queryAll: async (dbId) => (dbId === 'bill-db' ? [{
      id: pageId,
      properties: {
        '名稱': { title: [{ plain_text: '信用卡費_星展' }] },
        '下次繳費': { formula: { type: 'string', string: '2026-12-09' } },
        '繳費週期': { select: { name: '月' } },
        '價格': { number: 7000 },
        '金額帳期': { rich_text: [{ plain_text: '202610' }] },
        '暫停訂閱': { checkbox: false },
        '準備取消': { checkbox: false },
      },
    }] : []),
    createPage: async () => { created = true; },
  };
  const result = await bot.markBillPaid(
    notion, { billDbId: 'bill-db', billHistoryDbId: 'history-db' },
    pageId, 10000, '2026-12-09', new Date('2026-11-05T12:00:00+08:00'),
  );
  assert.equal(result.tooEarly, true);
  assert.equal(created, false);
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
        '名稱': { title: [{ plain_text: '電信費_台灣大哥大' }] },
        '下次繳費': { formula: { type: 'string', string: '2026-07-20' } },
        '價格': { number: 999 },
        '暫停訂閱': { checkbox: false },
        '準備取消': { checkbox: false },
      },
    }],
    updatePage: async (id, properties) => { updated = { id, properties }; },
  };
  const parsed = bot.parseTextCommand('更新金額 電信費_台灣大哥大 1,380');
  assert.deepEqual(parsed, { action: 'update_bill_amount', name: '電信費_台灣大哥大', amount: 1380 });
  const messages = await bot.handleCommand(parsed, notion, { billDbId: 'bill-db' });
  assert.equal(updated.id, pageId);
  assert.equal(updated.properties['價格'].number, 1380);
  assert.equal(updated.properties['金額帳期'].rich_text[0].text.content, '202607');
  assert.match(messages[0].text, /更新：\d{2}\/\d{2}/);
});

test('舊的確認繳費操作改為導向 Web App，不再於 LINE 寫入', async () => {
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
  assert.match(json, /前往 Web App 登記已繳/);
  assert.match(json, new RegExp(`/todo\\?tab=p&item=${pageId}&action=complete`));
  assert.doesNotMatch(json, /action=paid/);
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
