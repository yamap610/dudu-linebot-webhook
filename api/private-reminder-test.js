const crypto = require('node:crypto');
const { getConfig, createNotionClient } = require('../lib/bot');
const { createMorningMessage, pushLine } = require('../lib/morning-push');

const TOKEN_HASH = 'dd5e1a731db92585acd9009251ba7d5bc098118cefd7a09d17f0020d84d4ca47';

function authorized(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const actual = crypto.createHash('sha256').update(token).digest();
  const expected = Buffer.from(TOKEN_HASH, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

module.exports = async function privateReminderTest(req, res) {
  if (req.method !== 'POST') return res.status(405).send('method not allowed');
  if (!authorized(req)) return res.status(401).send('unauthorized');

  try {
    const config = getConfig();
    config.lineUserIds = [process.env.LINE_USER_ID].filter(Boolean);
    if (!config.lineToken || !config.notionToken || !config.calendarId || !config.googleServiceAccountJson) {
      return res.status(500).send('configuration error');
    }
    if (!config.lineUserIds.length) return res.status(500).send('no recipient');

    const notion = createNotionClient(config);
    const message = await createMorningMessage({ notion, config });
    if (!message) return res.status(200).json({ sent: 0, reason: 'nothing to remind' });
    const sent = await pushLine(message, config);
    return res.status(200).json({ sent });
  } catch (error) {
    console.error('Private reminder test failed', error);
    return res.status(500).send('push failed');
  }
};

module.exports._test = { authorized };
