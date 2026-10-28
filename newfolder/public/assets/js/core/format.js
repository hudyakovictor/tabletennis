const RU = 'ru-RU';

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function num(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(RU, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function compact(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1).replace('.', ',')}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1).replace('.', ',')}M`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e3).toFixed(0)}k`;
  return num(n);
}

export function money(value, currency = 'USD') {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const digits = Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 1 ? 2 : 3;
  return n.toLocaleString(RU, {
    style: 'currency',
    currency,
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function pct(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString(RU, { maximumFractionDigits: digits })}%`;
}

export function ms(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${Math.round(n)} мс`;
}

export function bytes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function dateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(RU, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function dateOnly(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(RU, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function timeAgo(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = Math.round((Date.now() - d.getTime()) / 1000);
  if (diff < 45) return 'только что';
  if (diff < 90) return 'минуту назад';
  if (diff < 3600) return `${Math.round(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.round(diff / 3600)} ч назад`;
  if (diff < 86400 * 30) return `${Math.round(diff / 86400)} дн назад`;
  return dateOnly(d);
}

export function countdown(value) {
  if (!value) return '—';
  const diff = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  if (Number.isNaN(diff)) return '—';
  if (diff <= 0) return 'просрочено';
  if (diff < 3600) return `${Math.round(diff / 60)} мин`;
  if (diff < 86400) return `${Math.round(diff / 3600)} ч`;
  return `${Math.round(diff / 86400)} дн`;
}

export function signClass(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return 'trend-flat';
  return n > 0 ? 'trend-up' : 'trend-down';
}

const STATUS_LABELS = {
  ok: 'в норме',
  warning: 'внимание',
  critical: 'критично',
  open: 'открыт',
  in_progress: 'в работе',
  answered: 'отвечен',
  closed: 'закрыт',
  pending: 'ожидает',
  applied: 'применено',
  rejected: 'отклонено',
  confirmed_fraud: 'фрод подтверждён',
  false_positive: 'ложное срабатывание',
  active: 'активен',
  suspended: 'приостановлен',
  banned: 'заблокирован',
  deleted: 'удалён',
  passed: 'пройден',
  failed: 'сбой',
  running: 'идёт',
  completed: 'завершён',
  stopped: 'остановлен',
  enabled: 'включено',
  disabled: 'выключено',
  resolved: 'решён',
  acknowledged: 'принят',
};
export function statusLabel(status) {
  return STATUS_LABELS[status] || status || '—';
}

export function truncate(value, max = 80) {
  const s = String(value ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function debounce(fn, wait = 250) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function parseQuery(str) {
  const out = {};
  new URLSearchParams(str || '').forEach((v, k) => { out[k] = v; });
  return out;
}
