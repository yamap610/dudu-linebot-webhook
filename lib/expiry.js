function propertyTitle(properties = {}) {
  for (const property of Object.values(properties)) {
    if (property?.type === 'title') {
      return (property.title || [])
        .map((item) => item.plain_text || item.text?.content || '')
        .join('').trim();
    }
  }
  return '未命名項目';
}

function propertyDate(property) {
  if (property?.type === 'date' || property?.date) {
    return String(property.date?.start || '').slice(0, 10);
  }
  const formula = property?.formula || {};
  if (formula.type === 'date') return String(formula.date?.start || '').slice(0, 10);
  if (formula.type === 'string') {
    const match = String(formula.string || '').match(/\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : '';
  }
  return '';
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

const REMINDER_WINDOW_DAYS = 5;
const REMINDER_WINDOWS = { 效期: 5, 耗材: 7, 保固: 30 };
const REMINDER_ICONS = { 效期: '⌛', 耗材: '🔄', 保固: '🛡️' };

async function getExpiryItems(notion, expiryDbId, today, { overdueOnly = false, includeAll = false } = {}) {
  if (!expiryDbId) return [];
  const pages = await notion.queryAll(expiryDbId, {
    filter: { property: '已處理', checkbox: { equals: false } },
    sorts: [{ property: '日期', direction: 'ascending' }],
  });

  return pages.map((page) => {
    const properties = page.properties || {};
    const dueDate = propertyDate(properties['日期'] || properties['到期更換日']);
    const type = properties['類型']?.select?.name || '效期';
    return {
      id: page.id,
      name: propertyTitle(properties),
      type,
      dueDate,
      handled: Boolean(properties['已處理']?.checkbox),
      reminderEnabled: properties['提醒']?.checkbox !== false,
      reminderDays: REMINDER_WINDOWS[type] || REMINDER_WINDOW_DAYS,
      daysRemaining: dueDate ? daysBetween(today, dueDate) : null,
    };
  }).filter((item) => (
    !item.handled
    && (includeAll || item.reminderEnabled)
    && Number.isInteger(item.daysRemaining)
    && (includeAll || item.daysRemaining <= item.reminderDays)
    && (!overdueOnly || item.daysRemaining < 0)
  )).sort((a, b) => (
    a.daysRemaining - b.daysRemaining
    || a.name.localeCompare(b.name, 'zh-TW')
  ));
}

function formatExpiryAll(items) {
  if (!items.length) return '';
  const lines = ['【 全部未處理期限 】'];
  lines.push(...items.map((item) => {
    const label = item.daysRemaining <= item.reminderDays
      ? expiryCountdown(item.daysRemaining, item.reminderDays)
      : item.dueDate.replace(/-/g, '/');
    return `${REMINDER_ICONS[item.type] || '⌛'} ${item.name}（${item.type}・${label}）`;
  }));
  return lines.join('\n');
}

function expiryCountdown(daysRemaining, windowDays = REMINDER_WINDOW_DAYS) {
  if (daysRemaining < 0) return `已過期 ${Math.abs(daysRemaining)} 天`;
  if (daysRemaining === 0) return '今天到期';
  if (daysRemaining >= 1 && daysRemaining <= windowDays) return `剩 ${daysRemaining} 天`;
  return '';
}

function formatExpiryBlock(items, heading = '【 期限提醒 】') {
  const visible = items.filter((item) => item.daysRemaining <= (item.reminderDays || REMINDER_WINDOW_DAYS));
  if (!visible.length) return '';
  return [
    heading,
    ...visible.map((item) => `${REMINDER_ICONS[item.type] || '⌛'} ${item.name}（${item.type || '效期'}・${expiryCountdown(item.daysRemaining, item.reminderDays)}）`),
  ].join('\n');
}

module.exports = {
  REMINDER_WINDOWS, REMINDER_ICONS,
  propertyTitle, propertyDate, daysBetween, getExpiryItems, expiryCountdown, formatExpiryBlock, formatExpiryAll,
};
