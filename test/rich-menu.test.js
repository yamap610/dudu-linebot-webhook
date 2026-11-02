const test = require('node:test');
const assert = require('node:assert/strict');

const { moreMenuMessage } = require('../lib/bot');
const { richMenu } = require('../scripts/setup-rich-menu');

test('Rich Menu 六格對應日常與提醒入口', () => {
  assert.deepEqual(richMenu.areas.map((area) => area.action.text), [
    '待辦', '待買', '待繳', '期限', '行程', '更多',
  ]);
  assert.ok(richMenu.areas.every((area) => area.action.type === 'message'));
  assert.deepEqual(richMenu.size, { width: 2500, height: 1686 });
  assert.equal(richMenu.chatBarText, '呼叫小秘書🙌🏻');
  assert.equal(richMenu.selected, true);
});

test('更多功能包含 WebApp，快速新增維持最下方', () => {
  const message = moreMenuMessage({ webappUrl: 'https://my-secretary-fawn.vercel.app/' });
  const actions = message.contents.footer.contents.map((item) => item.action);
  assert.deepEqual(actions.filter((action) => action.type === 'postback').map((action) => action.data), [
    'action=anniversaries',
    'action=waste_menu',
    'action=quick_add',
  ]);
  assert.deepEqual(actions[2], {
    type: 'uri', label: '🌐 開啟完整管理', uri: 'https://my-secretary-fawn.vercel.app/',
  });
  assert.equal(actions.at(-1).label, '➕ 快速新增');
  assert.doesNotMatch(JSON.stringify(message), /小百科|Notion/);
});
