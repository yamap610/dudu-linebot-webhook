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

async function getExpiryItems(notion, expiryDbId, today, { overdueOnly = false, includeAll = false } = {}) {
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
    && (includeAll || item.daysRemaining <= 3)
    && (!overdueOnly || item.daysRemaining < 0)
  )).sort((a, b) => (
    a.daysRemaining - b.daysRemaining
    || a.name.localeCompare(b.name, 'zh-TW')
  ));
}

function formatExpiryAll(items) {
  if (!items.length) return '';
  const lines = ['【 全部未處理效期 】'];
  lines.push(...items.map((item) => {
    const label = item.daysRemaining <= 3
      ? expiryCountdown(item.daysRemaining)
      : item.dueDate.replace(/-/g, '/');
    return `⌛ ${item.name}（${label}）`;
  }));
  return lines.join('\n');
}

function expiryCountdown(daysRemaining) {
  if (daysRemaining < 0) return `已過期 ${Math.abs(daysRemaining)} 天`;
  if (daysRemaining === 0) return '今天到期';
  if (daysRemaining >= 1 && daysRemaining <= 3) return `剩 ${daysRemaining} 天`;
  return '';
}

function formatExpiryBlock(items, heading = '【 效期提醒｜已過期／3 天內 】') {
  const visible = items.filter((item) => item.daysRemaining <= 3);
  if (!visible.length) return '';
  return [
    heading,
    ...visible.map((item) => `⌛ ${item.name}（${expiryCountdown(item.daysRemaining)}）`),
  ].join('\n');
}

module.exports = {
  propertyTitle, propertyDate, daysBetween, getExpiryItems, expiryCountdown, formatExpiryBlock, formatExpiryAll,
};
