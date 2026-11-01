const test = require('node:test');
const assert = require('node:assert/strict');

const { quickAddMessage, parseTextCommand, handleCommand } = require('../lib/bot');

test('快速新增包含期限提醒與紀念日', () => {
  const message = quickAddMessage();
  const actions = message.quickReply.items.map((item) => item.action);
  assert.deepEqual(actions.map((action) => action.label), [
    '✅ 新增待辦', '🛒 新增待買', '📅 新增行程', '⏳ 新增期限提醒', '🎈 新增紀念日',
  ]);
  assert.equal(actions[3].data, 'action=expiry_add_menu');
  assert.equal(actions[4].data, 'action=anniversary_add_menu');
});

test('LINE 可新增期限類型並自行選擇是否提醒', async () => {
  assert.deepEqual(parseTextCommand('新增期限｜耗材｜濾芯'), {
    action: 'expiry_add_date', type: '耗材', name: '濾芯',
  });
  let created;
  const notion = {
    getDatabase: async () => ({ properties: {
      品項: { type: 'title' },
      到期更換日: { type: 'date' },
      類型: { type: 'select' },
      已處理: { type: 'checkbox' },
      提醒: { type: 'checkbox' },
    } }),
    createPage: async (dbId, properties) => { created = { dbId, properties }; },
  };
  const [message] = await handleCommand({
    action: 'expiry_add_create', type: '耗材', name: '濾芯', date: '2026-11-05', reminder: '0',
  }, notion, { expiryDbId: 'expiry-db' });
  assert.equal(created.dbId, 'expiry-db');
  assert.deepEqual(created.properties['品項'], { title: [{ text: { content: '濾芯' } }] });
  assert.deepEqual(created.properties['到期更換日'], { date: { start: '2026-11-05' } });
  assert.deepEqual(created.properties['類型'], { select: { name: '耗材' } });
  assert.deepEqual(created.properties['已處理'], { checkbox: false });
  assert.deepEqual(created.properties['提醒'], { checkbox: false });
  assert.match(message.text, /已新增耗材/);
  assert.match(message.text, /提醒：未開啟/);
});

test('期限資料庫缺少類型欄位時會自動建立選項', async () => {
  let schemaUpdate;
  let created;
  const notion = {
    getDatabase: async () => ({ properties: {
      品項: { type: 'title' }, 日期: { type: 'date' },
      已處理: { type: 'checkbox' }, 提醒: { type: 'checkbox' },
    } }),
    updateDatabase: async (dbId, properties) => { schemaUpdate = { dbId, properties }; },
    createPage: async (_dbId, properties) => { created = properties; },
  };
  await handleCommand({
    action: 'expiry_add_create', type: '保固', name: '吸塵器', date: '2027-10-01', reminder: '1',
  }, notion, { expiryDbId: 'expiry-db' });
  assert.equal(schemaUpdate.dbId, 'expiry-db');
  assert.deepEqual(schemaUpdate.properties['類型'].select.options.map((item) => item.name), ['效期', '耗材', '保固']);
  assert.deepEqual(created['類型'], { select: { name: '保固' } });
  assert.deepEqual(created['提醒'], { checkbox: true });
});

test('LINE 可新增每年重複且開啟提醒的紀念日', async () => {
  assert.deepEqual(parseTextCommand('新增紀念日｜生日｜嘟嘟生日'), {
    action: 'anniversary_add_date', type: '生日', name: '嘟嘟生日',
  });
  let created;
  const notion = {
    getDatabase: async () => ({ properties: {
      名稱: { type: 'title' }, 日期: { type: 'date' }, 類型: { type: 'select' },
      每年重複: { type: 'checkbox' }, 'Line Bot 提醒': { type: 'checkbox' },
    } }),
    createPage: async (dbId, properties) => { created = { dbId, properties }; },
  };
  const [message] = await handleCommand({
    action: 'anniversary_add_create', type: '生日', name: '嘟嘟生日', date: '2024-09-18', repeat: '1',
  }, notion, { anniversaryDbId: 'anniversary-db' });
  assert.equal(created.dbId, 'anniversary-db');
  assert.deepEqual(created.properties['日期'], { date: { start: '2024-09-18' } });
  assert.deepEqual(created.properties['類型'], { select: { name: '生日' } });
  assert.deepEqual(created.properties['每年重複'], { checkbox: true });
  assert.deepEqual(created.properties['Line Bot 提醒'], { checkbox: true });
  assert.match(message.text, /每年重複提醒/);
});
