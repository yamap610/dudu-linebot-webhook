const test = require('node:test');
const assert = require('node:assert/strict');

const { handleCommand } = require('../lib/bot');

const PAGE_ID = '11111111-1111-1111-1111-111111111111';
const BLOCK_ID = '22222222-2222-2222-2222-222222222222';

function page(name = '全聯待買', hasDetails = true) {
  return {
    id: PAGE_ID,
    url: `https://notion.so/${PAGE_ID}`,
    properties: {
      項目名稱: { title: [{ plain_text: name }] },
      優先級: { select: { name: '急' } },
      類別: { select: { name: '食品' } },
      說明: { rich_text: [{ plain_text: '要買的東西在裡面' }] },
      內含明細: { checkbox: hasDetails },
    },
  };
}

function todoBlock(checked = false) {
  return {
    id: BLOCK_ID, type: 'to_do', has_children: false,
    to_do: { checked, rich_text: [{ plain_text: '雞蛋' }] },
  };
}

test('待買有內容 checklist 時顯示 Notion 開啟清單連結', async () => {
  const notion = {
    queryAll: async () => [page()],
    getBlockChildren: async () => assert.fail('清單頁不應逐筆讀取 Notion 內容'),
  };
  const [message] = await handleCommand({ action: 'list', type: 'buy' }, notion, { todoDbId: 'db' });
  const output = JSON.stringify(message);
  assert.match(output, /開啟清單/);
  assert.match(output, /"type":"uri"/);
  assert.match(output, /https:\/\/notion\.so/);
});

test('沒有 checklist 時只保留完成按鈕', async () => {
  const notion = {
    queryAll: async () => [page('買牛奶', false)],
    getBlockChildren: async () => assert.fail('清單頁不應逐筆讀取 Notion 內容'),
  };
  const [message] = await handleCommand({ action: 'list', type: 'buy' }, notion, { todoDbId: 'db' });
  const output = JSON.stringify(message);
  assert.doesNotMatch(output, /開啟清單/);
  assert.match(output, /已買到/);
});

test('LINE 勾選 checklist 後靜默同步 Notion，不堆疊新卡片', async () => {
  let checked = false;
  const notion = {
    getPage: async () => page(),
    getBlockChildren: async () => ({ results: [todoBlock(checked)] }),
    updateBlock: async (id, body) => {
      assert.equal(id, BLOCK_ID.replaceAll('-', ''));
      checked = body.to_do.checked;
    },
  };
  const messages = await handleCommand({
    action: 'checklist_toggle', type: 'buy', id: PAGE_ID, block: BLOCK_ID, checked: '1', page: '1',
  }, notion, {});
  assert.equal(checked, true);
  assert.deepEqual(messages, []);
});

test('內容清單提供手動重新整理按鈕', async () => {
  const notion = {
    getPage: async () => page(),
    getBlockChildren: async () => ({ results: [todoBlock()] }),
  };
  const [message] = await handleCommand({ action: 'checklist', type: 'buy', id: PAGE_ID, page: '1' }, notion, {});
  const output = JSON.stringify(message);
  assert.match(output, /重新整理清單/);
  assert.match(output, /點選後會直接同步/);
  const selectAction = message.contents.body.contents.find((component) => component.type === 'box');
  assert.equal(selectAction.contents.at(-1).type, 'text');
  assert.equal(selectAction.contents.at(-1).size, 'xs');
});

test('拒絕更新不屬於該頁面的 block', async () => {
  const notion = {
    getBlockChildren: async () => ({ results: [] }),
    updateBlock: async () => assert.fail('不應更新 block'),
  };
  await assert.rejects(
    () => handleCommand({
      action: 'checklist_toggle', type: 'todo', id: PAGE_ID, block: BLOCK_ID, checked: '1', page: '1',
    }, notion, {}),
    /找不到這個清單項目/,
  );
});

test('LINE 新增待辦可選日期並寫入 Notion', async () => {
  const [dateMessage] = await handleCommand({
    action: 'add', type: 'todo', priority: '急', name: '回桃園待辦',
  }, {}, {});
  assert.match(JSON.stringify(dateMessage), /預定作業日期/);
  assert.match(JSON.stringify(dateMessage), /datetimepicker/);

  const [descriptionMessage] = await handleCommand({
    action: 'add_date', type: 'todo', priority: '急', name: '回桃園待辦', date: '2026-08-01',
  }, {}, {});
  assert.match(JSON.stringify(descriptionMessage), /2026-08-01/);

  let created;
  const notion = { createPage: async (_db, properties) => { created = properties; return { id: PAGE_ID }; } };
  const [createdMessage] = await handleCommand({
    action: 'add_create', type: 'todo', priority: '急', name: '回桃園待辦', date: '2026-08-01',
  }, notion, { todoDbId: 'db' });
  assert.deepEqual(created['預定作業日期'], { date: { start: '2026-08-01' } });
  assert.match(createdMessage.text, /預定作業日期：2026-08-01/);
});

test('LINE 可編輯優先級、日期及清除日期', async () => {
  let current = page('回桃園待辦');
  current.properties['預定作業日期'] = { date: { start: '2026-08-01' } };
  const notion = {
    getPage: async () => current,
    getBlockChildren: async () => ({ results: [] }),
    updatePage: async (_id, properties) => {
      if (properties['優先級']) current.properties['優先級'] = properties['優先級'];
      if (Object.hasOwn(properties, '預定作業日期')) current.properties['預定作業日期'] = properties['預定作業日期'];
    },
  };
  const [menu] = await handleCommand({ action: 'edit_reminder', type: 'todo', id: PAGE_ID }, notion, {});
  assert.match(menu.text, /預定作業日期：2026-08-01/);

  const [priorityResult] = await handleCommand({
    action: 'edit_priority', type: 'todo', id: PAGE_ID, priority: '中',
  }, notion, {});
  assert.match(priorityResult.text, /目前優先級：中/);

  const [dateResult] = await handleCommand({
    action: 'edit_date', type: 'todo', id: PAGE_ID, date: '2026-08-05',
  }, notion, {});
  assert.match(dateResult.text, /預定作業日期：2026-08-05/);

  const [clearResult] = await handleCommand({
    action: 'edit_date', type: 'todo', id: PAGE_ID, clear: '1',
  }, notion, {});
  assert.match(clearResult.text, /預定作業日期：未設定/);
});
