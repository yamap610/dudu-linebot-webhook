const { getConfig, createNotionClient } = require('../lib/bot');
const { createMorningMessage, pushLine } = require('../lib/morning-push');

function authorized(req, secret) {
  if (!secret) return false;
  return req.headers.authorization === `Bearer ${secret}`;
}

module.exports = async function morningPush(req, res) {
  if (req.method !== 'POST') return res.status(405).send('method not allowed');
  if (!authorized(req, process.env.CRON_SECRET)) return res.status(401).send('unauthorized');

  try {
    const config = getConfig();
    config.lineUserIds = [process.env.LINE_USER_ID, process.env.LINE_USER_ID_2].filter(Boolean);
    if (!config.lineToken || !config.notionToken || !config.calendarId || !config.googleServiceAccountJson) {
      return res.status(500).send('configuration error');
    }
    if (!config.lineUserIds.length) return res.status(500).send('no recipients');

    const notion = createNotionClient(config);
    const message = await createMorningMessage({ notion, config });
    if (!message) return res.status(200).json({ sent: 0, reason: 'nothing to remind' });
    const sent = await pushLine(message, config);
    return res.status(200).json({ sent });
  } catch (error) {
    console.error('Morning push failed', error);
    return res.status(500).send('push failed');
  }
};

module.exports._test = { authorized };
