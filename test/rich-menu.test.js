const test = require('node:test');
const assert = require('node:assert/strict');

const { moreMenuMessage } = require('../lib/bot');
const { richMenu } = require('../scripts/setup-rich-menu');

test('Rich Menu 六格對應日常與提醒入口', () => {
  assert.deepEqual(richMenu.areas.map((area) => area.action.data), [
    'action=bills',
    'action=expiry',
    'action=calendar_menu',
    'action=list&type=todo',
    'action=list&type=buy',
    'action=more_menu',
  ]);
  assert.deepEqual(richMenu.size, { width: 2500, height: 1686 });
});

test('更多功能只保留紀念日、垃圾分類與快速新增', () => {
  const message = moreMenuMessage();
  const actions = message.contents.footer.contents.map((item) => item.action);
  assert.deepEqual(actions.map((action) => action.data), [
    'action=anniversaries',
    'action=waste_menu',
    'action=quick_add',
  ]);
  assert.equal(actions.at(-1).label, '➕ 快速新增');
  assert.doesNotMatch(JSON.stringify(message), /小百科|生活秘書/);
});
