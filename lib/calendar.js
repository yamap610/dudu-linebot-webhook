const crypto = require('crypto');

let tokenCache = null;

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function parseServiceAccount(value) {
  if (!value) throw new Error('尚未設定 GOOGLE_SERVICE_ACCOUNT_JSON');
  try { return typeof value === 'string' ? JSON.parse(value) : value; } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON 不是有效的 JSON');
  }
}

async function getAccessToken(serviceAccountJson, fetchImpl = fetch, now = Date.now()) {
  if (tokenCache && tokenCache.expiresAt > now + 60000) return tokenCache.value;
  const account = parseServiceAccount(serviceAccountJson);
  if (!account.client_email || !account.private_key) throw new Error('Google 服務帳號金鑰缺少必要欄位');
  const issuedAt = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud: 'https://oauth2.googleapis.com/token',
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), account.private_key).toString('base64url');
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(`Google 授權失敗：${data.error_description || data.error || response.status}`);
  tokenCache = { value: data.access_token, expiresAt: now + Number(data.expires_in || 3600) * 1000 };
  return tokenCache.value;
}

function createCalendarClient(config, fetchImpl = fetch) {
  async function request(path, options = {}) {
    if (!config.calendarId) throw new Error('尚未設定 CALENDAR_ID');
    const token = await getAccessToken(config.googleServiceAccountJson, fetchImpl);
    const response = await fetchImpl(`https://www.googleapis.com/calendar/v3${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Google Calendar API：${data.error?.message || response.status}`);
    return data;
  }

  return {
    async listEvents(startDate, endDate) {
      const params = new URLSearchParams({
        timeMin: `${startDate}T00:00:00+08:00`,
        timeMax: `${endDate}T00:00:00+08:00`,
        singleEvents: 'true', orderBy: 'startTime', maxResults: '50',
      });
      const data = await request(`/calendars/${encodeURIComponent(config.calendarId)}/events?${params}`);
      return data.items || [];
    },
    async createEvent({ title, date, time }) {
      const event = time
        ? { summary: title, start: { dateTime: `${date}T${time}:00+08:00`, timeZone: 'Asia/Taipei' }, end: { dateTime: `${date}T${time}:00+08:00`, timeZone: 'Asia/Taipei' } }
        : { summary: title, start: { date }, end: { date: addDays(date, 1) } };
      if (time) {
        const end = new Date(`${date}T${time}:00+08:00`);
        end.setTime(end.getTime() + 60 * 60 * 1000);
        event.end.dateTime = new Intl.DateTimeFormat('sv-SE', {
          timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        }).format(end).replace(' ', 'T') + '+08:00';
      }
      return request(`/calendars/${encodeURIComponent(config.calendarId)}/events`, { method: 'POST', body: JSON.stringify(event) });
    },
  };
}

function addDays(dateString, amount) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function weekRange(today, offset = 0) {
  const date = new Date(`${today}T00:00:00Z`);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  const start = addDays(today, -mondayOffset + offset * 7);
  return { start, end: addDays(start, 7) };
}

function eventDate(event) {
  return (event.start?.dateTime || event.start?.date || '').slice(0, 10);
}

function eventTime(event) {
  if (!event.start?.dateTime) return '整天';
  const match = event.start.dateTime.match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : '';
}

module.exports = { createCalendarClient, getAccessToken, addDays, weekRange, eventDate, eventTime };
