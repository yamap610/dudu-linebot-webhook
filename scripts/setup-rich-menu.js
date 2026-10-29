const fs = require('fs');
const path = require('path');

const LINE_TOKEN = process.env.LINE_TOKEN;
const IMAGE_PATH = process.env.RICH_MENU_IMAGE || path.resolve(__dirname, '..', 'assets', 'rich-menu-expiry-hourglass.jpg');

const richMenu = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: '嘟嘟一家主選單｜效期提醒',
  chatBarText: '小秘書幫幫我✨',
  areas: [
    {
      bounds: { x: 0, y: 0, width: 833, height: 843 },
      action: { type: 'postback', data: 'action=bills', displayText: '訂閱／待繳' },
    },
    {
      bounds: { x: 833, y: 0, width: 833, height: 843 },
      action: { type: 'postback', data: 'action=expiry', displayText: '效期提醒' },
    },
    {
      bounds: { x: 1666, y: 0, width: 834, height: 843 },
      action: { type: 'postback', data: 'action=calendar_menu', displayText: '行程查詢' },
    },
    {
      bounds: { x: 0, y: 843, width: 833, height: 843 },
      action: { type: 'postback', data: 'action=list&type=todo', displayText: '待辦事項' },
    },
    {
      bounds: { x: 833, y: 843, width: 833, height: 843 },
      action: { type: 'postback', data: 'action=list&type=buy', displayText: '待買清單' },
    },
    {
      bounds: { x: 1666, y: 843, width: 834, height: 843 },
      action: { type: 'postback', data: 'action=quick_add', displayText: '快速新增' },
    },
  ],
};

async function lineRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${LINE_TOKEN}`, ...(options.headers || {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`LINE API ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

async function main() {
  if (!LINE_TOKEN) throw new Error('缺少 LINE_TOKEN，未變更 LINE Rich Menu。');
  if (!fs.existsSync(IMAGE_PATH)) throw new Error(`找不到 Rich Menu 圖片：${IMAGE_PATH}`);
  let richMenuId;
  try {
    const previous = await lineRequest('https://api.line.me/v2/bot/user/all/richmenu').catch(() => ({}));
    if (previous.richMenuId) console.log(`原預設 Rich Menu 保留：${previous.richMenuId}`);
    const created = await lineRequest('https://api.line.me/v2/bot/richmenu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(richMenu),
    });
    richMenuId = created.richMenuId;

    await lineRequest(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
      method: 'POST',
      headers: { 'Content-Type': path.extname(IMAGE_PATH).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg' },
      body: fs.readFileSync(IMAGE_PATH),
    });

    await lineRequest(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, { method: 'POST' });
    console.log(`Rich Menu 已建立並設為預設：${richMenuId}`);
  } catch (error) {
    if (richMenuId) {
      await lineRequest(`https://api.line.me/v2/bot/richmenu/${richMenuId}`, { method: 'DELETE' }).catch(() => {});
    }
    throw error;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Rich Menu 設定失敗：${error.message}`);
    process.exit(1);
  });
}

module.exports = { richMenu, main };
