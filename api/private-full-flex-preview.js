const crypto = require('node:crypto');
const { getConfig, createNotionClient } = require('../lib/bot');
const { createMorningMessage, pushLine } = require('../lib/morning-push');

const TOKEN_HASH = '94c89bd093ac0c4a648b61c2d7d6329a1043aad0a79dd703d4461a449c9580b8';

function authorized(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const actual = crypto.createHash('sha256').update(token).digest();
  const expected = Buffer.from(TOKEN_HASH, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function richLine(text, margin = 'sm') {
  const matches = [...text.matchAll(/(?:逾期|已過期)\s*\d+\s*天/g)];
  if (!matches.length) return { type: 'text', text, size: 'sm', color: '#514944', wrap: true, margin };
  const contents = [];
  let offset = 0;
  for (const match of matches) {
    if (match.index > offset) contents.push({ type: 'span', text: text.slice(offset, match.index) });
    contents.push({ type: 'span', text: match[0], size: 'xs', color: '#D85C5C', weight: 'bold' });
    offset = match.index + match[0].length;
  }
  if (offset < text.length) contents.push({ type: 'span', text: text.slice(offset) });
  return { type: 'text', text, contents, size: 'sm', color: '#514944', wrap: true, margin };
}

function listRow(text) {
  const match = text.match(/^(.*)（([^）]+)）$/);
  if (!match) return { type: 'text', text, size: 'sm', color: '#514944', wrap: true, margin: 'sm' };
  const overdue = match[2].startsWith('逾期');
  return {
    type: 'box', layout: 'horizontal', alignItems: 'center', margin: 'sm', contents: [
      { type: 'text', text: match[1], size: 'sm', color: '#514944', wrap: true, flex: 1 },
      {
        type: 'text', text: match[2], size: 'xs', align: 'end', flex: 0, margin: 'md',
        color: overdue ? '#D85C5C' : '#8A817D', weight: overdue ? 'bold' : 'regular',
      },
    ],
  };
}

function flexFromMorning(message, title) {
  const lines = message.text.split('\n');
  const date = (lines.shift().split('｜')[1] || '').trim();
  const body = [];
  let section = '';
  let hasSection = false;
  for (const raw of lines) {
    const text = raw.trim();
    if (!text) continue;
    const sectionMatch = text.match(/^【\s*(.*?)\s*】$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      body.push({
        type: 'text', text: section, size: 'sm', weight: 'bold', color: '#6F625D',
        margin: hasSection ? 'xl' : 'lg',
      });
      hasSection = true;
      continue;
    }
    body.push(['待買', '待辦'].includes(section) ? listRow(text) : richLine(text, body.length ? 'sm' : 'none'));
  }

  const appUri = message.quickReply?.items?.[0]?.action?.uri;
  return {
    type: 'flex', altText: `${title}｜${date}`,
    contents: {
      type: 'bubble', size: 'giga',
      header: {
        type: 'box', layout: 'vertical', paddingAll: '18px', backgroundColor: '#F6F1EE', contents: [
          { type: 'text', text: title, size: 'xl', weight: 'bold', color: '#514944' },
          { type: 'text', text: date, size: 'sm', color: '#8F827C', margin: 'xs' },
        ],
      },
      body: { type: 'box', layout: 'vertical', paddingAll: '18px', contents: body },
      ...(appUri ? { footer: {
        type: 'box', layout: 'vertical', paddingAll: '14px', contents: [{
          type: 'button', style: 'primary', height: 'sm', color: '#78BDD1',
          action: { type: 'uri', label: '開啟 App 處理', uri: appUri },
        }],
      } } : {}),
    },
  };
}

module.exports = async function privateFullFlexPreview(req, res) {
  if (req.method !== 'POST') return res.status(405).send('method not allowed');
  if (!authorized(req)) return res.status(401).send('unauthorized');
  try {
    const config = getConfig();
    config.lineUserIds = [process.env.LINE_USER_ID].filter(Boolean);
    if (!config.lineToken || !config.notionToken || !config.calendarId
      || !config.googleServiceAccountJson || !config.lineUserIds.length) {
      return res.status(500).send('configuration error');
    }
    const notion = createNotionClient(config);
    const morning = await createMorningMessage({ notion, config, dayOffset: 0 });
    const evening = await createMorningMessage({ notion, config, dayOffset: 1 });
    if (!morning || !evening) return res.status(422).json({ sent: 0, reason: 'preview data unavailable' });
    await pushLine(flexFromMorning(morning, '☀️ 今日小叮嚀'), config);
    await pushLine(flexFromMorning(evening, '🌙 明日小叮嚀'), config);
    return res.status(200).json({ sent: 2, recipients: 1 });
  } catch (error) {
    console.error('Private full Flex preview failed', error);
    return res.status(500).send('push failed');
  }
};

module.exports._test = { authorized, flexFromMorning };
