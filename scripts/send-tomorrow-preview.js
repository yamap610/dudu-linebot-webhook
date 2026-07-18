const { getConfig, createNotionClient } = require('../lib/bot');
const { createMorningMessage, pushLine } = require('../lib/morning-push');

async function main() {
  const config = getConfig();
  config.lineUserIds = [process.env.LINE_USER_ID, process.env.LINE_USER_ID_2].filter(Boolean);
  if (!config.lineToken || !config.notionToken || !config.calendarId || !config.googleServiceAccountJson) {
    throw new Error('缺少明日預告所需設定');
  }
  if (!config.lineUserIds.length) throw new Error('沒有 LINE 收件人');

  const notion = createNotionClient(config);
  const message = await createMorningMessage({ notion, config, dayOffset: 1 });
  if (!message) {
    console.log('明天沒有需要提醒的內容，未發送。');
    return;
  }
  const sent = await pushLine(message, config);
  console.log(`明日合併預告已發送給 ${sent} 位收件人。`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
