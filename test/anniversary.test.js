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
  const rendered = JSON.stringify(message);
  assert.equal(message.type, 'flex');
  assert.match(rendered, /一次活動/);
  assert.match(rendered, /交往紀念日/);
  assert.match(rendered, /3 週年/);
  assert.match(rendered, /翠翠生日/);
  assert.match(rendered, /32 歲/);
  assert.match(rendered, /🎈 近期紀念日/);
  assert.doesNotMatch(rendered, /21:00|08:00|尚未開啟提醒/);
});

test('近期只顯示五個，顯示全部後以五個一頁左右滑動', () => {
  const items = Array.from({ length: 7 }, (_, index) => ({
    name: `重要日子 ${index + 1}`,
    date: `2020-11-${String(index + 1).padStart(2, '0')}`,
    nextDate: `2026-11-${String(index + 1).padStart(2, '0')}`,
    type: '紀念日',
    repeatsYearly: true,
    lineReminder: true,
  }));
  const recent = anniversaryListMessage(items, '2026-10-29');
  const recentRendered = JSON.stringify(recent);
  assert.match(recentRendered, /重要日子 5/);
  assert.doesNotMatch(recentRendered, /重要日子 6/);
  assert.match(recentRendered, /action=anniversaries_all/);

  const all = anniversaryListMessage(items, '2026-10-29', { showAll: true });
  assert.equal(all.contents.type, 'carousel');
  assert.equal(all.contents.contents.length, 2);
  assert.match(JSON.stringify(all), /重要日子 7/);
});
