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

async function getExpiryItems(notion, expiryDbId, today, { overdueOnly = false } = {}) {
  if (!expiryDbId) return [];
  const pages = await notion.queryAll(expiryDbId, {
    filter: { property: '已處理', checkbox: { equals: false } },
    sorts: [{ property: '日期', direction: 'ascending' }],
  });

  return pages.map((page) => {
    const properties = page.properties || {};
    const dueDate = propertyDate(properties['日期'] || properties['到期更換日']);
    return {
      id: page.id,
      name: propertyTitle(properties),
      dueDate,
      handled: Boolean(properties['已處理']?.checkbox),
      daysRemaining: dueDate ? daysBetween(today, dueDate) : null,
    };
  }).filter((item) => (
    !item.handled
    && Number.isInteger(item.daysRemaining)
    && item.daysRemaining <= 3
    && (!overdueOnly || item.daysRemaining < 0)
  )).sort((a, b) => (
    a.daysRemaining - b.daysRemaining
    || a.name.localeCompare(b.name, 'zh-TW')
  ));
}

function expiryCountdown(daysRemaining) {
  if (daysRemaining < 0) return `已過期 ${Math.abs(daysRemaining)} 天`;
  if (daysRemaining === 0) return '今天到期';
  if (daysRemaining >= 1 && daysRemaining <= 3) return `剩 ${daysRemaining} 天`;
  return '';
}

function formatExpiryBlock(items, heading = '【 效期管家 】') {
  const overdue = items.filter((item) => item.daysRemaining < 0);
  const upcoming = items.filter((item) => item.daysRemaining >= 0 && item.daysRemaining <= 3);
  if (!overdue.length && !upcoming.length) return '';

  const lines = [heading];
  if (overdue.length) {
    lines.push('', '已過期');
    lines.push(...overdue.map((item) => `・${item.name}｜${expiryCountdown(item.daysRemaining)}`));
  }
  if (upcoming.length) {
    lines.push('', '3 天內');
    lines.push(...upcoming.map((item) => `・${item.name}｜${expiryCountdown(item.daysRemaining)}`));
  }
  return lines.join('\n');
}

module.exports = {
  propertyTitle, propertyDate, daysBetween, getExpiryItems, expiryCountdown, formatExpiryBlock,
};
