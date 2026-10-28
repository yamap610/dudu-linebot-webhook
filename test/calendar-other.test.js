const test = require('node:test');
const assert = require('node:assert/strict');
const { calendarAddMenuMessage, calendarLabelText } = require('../lib/bot');

test('新增行程選單包含月曆的其他標籤', () => {
  const message = calendarAddMenuMessage([{ id: 'other', name: '⭐ 其他' }]);
  const actions = message.quickReply.items.map((item) => item.action);
  const other = actions.find((action) => action.label === '⭐ 其他');
  assert.equal(other.data, 'action=calendar_add_label&label=%E2%AD%90%20%E5%85%B6%E4%BB%96');
  assert.equal(calendarLabelText('⭐ 其他'), '⭐ 其他');
});
