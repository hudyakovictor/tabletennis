'use strict';

/**
 * Shared request/response helpers for list endpoints.
 *
 * Every list in the CRM used to be a hard-coded `LIMIT 200` with no total, no
 * cursor and no stable ordering — unusable at 100k players and impossible to export.
 * These helpers give all list routes the same contract:
 *
 *   { items, page, pageSize, total, totalPages, sort, order }
 *
 * Sorting is whitelist-only (never interpolated from user input), and CSV export
 * neutralizes spreadsheet formula injection (`=cmd|...`), which is a real attack
 * vector when an operator opens an exported ticket list in Excel.
 */

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 200;

function parseListQuery(urlObj, { allowedSort = [], defaultSort = 'created_at', defaultOrder = 'desc' } = {}) {
  const params = urlObj.searchParams;
  const page = Math.max(1, Math.min(10_000, Number(params.get('page') || 1) || 1));
  const rawSize = Number(params.get('pageSize') || params.get('limit') || DEFAULT_PAGE_SIZE);
  const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, Number.isFinite(rawSize) ? rawSize : DEFAULT_PAGE_SIZE));
  const requestedSort = String(params.get('sort') || defaultSort);
  const sort = allowedSort.includes(requestedSort) ? requestedSort : defaultSort;
  const order = String(params.get('order') || defaultOrder).toLowerCase() === 'asc' ? 'asc' : 'desc';
  const q = String(params.get('q') || '').trim().slice(0, 120);
  return { page, pageSize, offset: (page - 1) * pageSize, sort, order, q };
}

function listResponse(items, { page, pageSize, total, sort, order }) {
  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    sort,
    order,
  };
}

function countTotal(db, fromWhereSql, params = []) {
  const row = db.prepare(`SELECT COUNT(*) AS c ${fromWhereSql}`).get(...params);
  return Number(row?.c || 0);
}

function parseJsonColumn(raw, fallback = {}) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * Neutralizes CSV formula injection and keeps the file round-trippable.
 */
function csvCell(value) {
  if (value === null || value === undefined) return '';
  let str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  if (/[",\n\r;]/.test(str)) str = `"${str.replace(/"/g, '""')}"`;
  return str;
}

function toCsv(columns, rows) {
  const header = columns.map((c) => csvCell(c.label || c.key)).join(',');
  const body = rows
    .map((row) => columns.map((c) => csvCell(typeof c.value === 'function' ? c.value(row) : row[c.key])).join(','))
    .join('\n');
  // BOM keeps Cyrillic readable in Excel without manual encoding selection.
  return `\ufeff${header}\n${body}`;
}

function csvResult(filename, text) {
  const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  return {
    status: 200,
    contentType: 'text/csv; charset=utf-8',
    headers: {
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'Cache-Control': 'no-store',
    },
    rawText: text,
  };
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  parseListQuery,
  listResponse,
  countTotal,
  parseJsonColumn,
  csvCell,
  toCsv,
  csvResult,
};
