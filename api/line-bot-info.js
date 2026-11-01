const { richMenu } = require('../scripts/setup-rich-menu');

module.exports = async function lineBotInfo(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const token = process.env.LINE_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'LINE_TOKEN is not configured' });
    return;
  }

  try {
    const response = await fetch('https://api.line.me/v2/bot/info', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json();
    if (!response.ok) {
      res.status(502).json({ error: data.message || `LINE API ${response.status}` });
      return;
    }
    const defaultResponse = await fetch('https://api.line.me/v2/bot/user/all/richmenu', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const defaultMenu = defaultResponse.ok ? await defaultResponse.json() : {};
    let currentRichMenu = null;
    if (defaultMenu.richMenuId) {
      const menuResponse = await fetch(`https://api.line.me/v2/bot/richmenu/${defaultMenu.richMenuId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (menuResponse.ok) currentRichMenu = await menuResponse.json();
    }
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.status(200).json({
      displayName: data.displayName,
      basicId: data.basicId,
      pictureUrl: data.pictureUrl,
      desiredRichMenuName: richMenu.name,
      defaultRichMenuId: defaultMenu.richMenuId || null,
      currentRichMenu,
    });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
};
