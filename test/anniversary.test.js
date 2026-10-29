const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseTextCommand, getUpcomingAnniversaries, anniversaryListMessage,
} = require('../lib/bot');

function anniversary(name, date, type = '紀念日', repeatsYearly = true, lineReminder = true) {
  return {
    id: name.padEnd(32, 'a').slice(0, 32),
    properties: {
      名稱: { title: [{ plain_text: name }] },
      日期: { date: { start: date } },
      類型: { select: { name: type } },
      每年重複: { checkbox: repeatsYearly },
      'Line Bot 提醒': { checkbox: lineReminder },
    },
  };
}

test('紀念日關鍵字可開啟 LINE 內近期清單', () => {
  assert.deepEqual(parseTextCommand('紀念日'), { action: 'anniversaries' });
  assert.deepEqual(parseTextCommand('生日'), { action: 'anniversaries' });
});

test('近期紀念日會跨年排序並顯示提醒狀態', async () => {
  const notion = { queryAll: async () => [
    anniversary('交往紀念日', '2023-12-21'),
    anniversary('翠翠生日', '1995-03-16', '生日', true, false),
    anniversary('一次活動', '2026-11-02', '其他', false, true),
    anniversary('過期的一次活動', '2026-01-01', '其他', false, true),
  ] };
  const items = await getUpcomingAnniversaries(notion, { anniversaryDbId: 'db' }, '2026-10-29');
  assert.deepEqual(items.map((item) => item.name), ['一次活動', '交往紀念日', '翠翠生日']);

  const message = anniversaryListMessage(items, '2026-10-29');
  assert.match(message.text, /一次活動/);
  assert.match(message.text, /交往紀念日・3 週年/);
  assert.match(message.text, /翠翠生日・32 歲/);
  assert.match(message.text, /🔔/);
  assert.match(message.text, /🔕/);
  assert.match(message.text, /前一天 21:00 與當天 08:00/);
});
