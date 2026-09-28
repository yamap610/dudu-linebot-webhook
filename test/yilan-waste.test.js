const test = require('node:test');
const assert = require('node:assert/strict');
const bot = require('../lib/bot');

test('垃圾相關關鍵字會開啟宜蘭垃圾分類選單', () => {
  for (const keyword of ['垃圾', '垃圾分類', '回收']) {
    assert.deepEqual(bot.parseTextCommand(keyword), { action: 'waste_menu' });
  }
  const json = JSON.stringify(bot.yilanWasteMenuMessage());
  assert.match(json, /資源回收日/);
  assert.match(json, /資源回收分類表/);
  assert.match(json, /廚餘分類表/);
  assert.match(json, /巡迴定點收運/);
});

test('直接關鍵字會對應正確垃圾分類圖片', () => {
  assert.deepEqual(bot.parseTextCommand('回收日'), { action: 'waste_image', topic: 'recycling_days' });
  assert.deepEqual(bot.parseTextCommand('資源回收'), { action: 'waste_image', topic: 'recycling_guide' });
  assert.deepEqual(bot.parseTextCommand('廚餘'), { action: 'waste_image', topic: 'food_waste' });
  assert.deepEqual(bot.parseTextCommand('定點垃圾車'), { action: 'waste_image', topic: 'fixed_collection' });
});

test('資源回收分類表回覆兩張 HTTPS 圖片，其餘各一張', async () => {
  const config = { publicBaseUrl: 'https://example.com/' };
  const guide = await bot.handleCommand(
    { action: 'waste_image', topic: 'recycling_guide' }, null, config,
  );
  assert.equal(guide.length, 2);
  assert.deepEqual(guide.map((message) => message.type), ['image', 'image']);
  assert.equal(guide[0].originalContentUrl, 'https://example.com/images/yilan-waste/recycling-guide-1.jpg');
  assert.equal(guide[1].originalContentUrl, 'https://example.com/images/yilan-waste/recycling-guide-2.jpg');
  assert.equal(guide[0].previewImageUrl, guide[0].originalContentUrl);

  for (const topic of ['recycling_days', 'food_waste', 'fixed_collection']) {
    const messages = bot.yilanWasteImageMessages(topic, config);
    assert.equal(messages.length, 1);
    assert.match(messages[0].originalContentUrl, /^https:\/\/example\.com\/images\/yilan-waste\//);
  }
});

test('未知的垃圾分類選項會安全返回選單', async () => {
  const [message] = await bot.handleCommand(
    { action: 'waste_image', topic: 'unknown' }, null, { publicBaseUrl: 'https://example.com' },
  );
  assert.equal(message.type, 'flex');
});
