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
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).json({
      displayName: data.displayName,
      basicId: data.basicId,
      pictureUrl: data.pictureUrl,
    });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
};
