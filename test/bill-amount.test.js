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
  }]));
  assert.match(json, /📅 10\/05 \$390/);
  assert.doesNotMatch(json, /07\/18更新/);
  assert.doesNotMatch(json, /2026\/10\/05/);
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
