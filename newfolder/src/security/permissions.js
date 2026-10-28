'use strict';

/**
 * Granular, least-privilege Permission Matrix (04-security.md -> «Роли»)
 *
 * The previous build gated almost every mutation behind a single `zones:read_all`
 * check, which made the 8 documented roles decorative. Here every capability is a
 * separate permission, permissions map 1:1 to API routes, and the same matrix drives
 * the navigation the operator actually sees — so the UI can never advertise an
 * action the server would reject.
 */

const { ROLES } = require('../config');

const PERMISSIONS = Object.freeze({
  // Executive layer
  DASHBOARD_READ: 'dashboard:read',
  SEARCH_GLOBAL: 'search:global',
  NOTIFICATIONS_READ: 'notifications:read',

  // Director layer
  DIRECTOR_READ: 'director:read',
  DIRECTOR_CHAT: 'director:chat',
  DIRECTOR_PRIORITIES: 'director:priorities',
  DIRECTOR_ARCHIVE: 'director:archive',

  // Zones — read/run are separate so a zone analyst can look but not spend tokens
  ZONE_OPS_READ: 'zone:ops:read',
  ZONE_OPS_RUN: 'zone:ops:run',
  ZONE_FRAUD_READ: 'zone:fraud:read',
  ZONE_FRAUD_RUN: 'zone:fraud:run',
  ZONE_BALANCE_READ: 'zone:balance:read',
  ZONE_BALANCE_RUN: 'zone:balance:run',
  ZONE_MARKET_READ: 'zone:market:read',
  ZONE_MARKET_RUN: 'zone:market:run',
  ZONE_LAB_READ: 'zone:lab:read',
  ZONE_LAB_RUN: 'zone:lab:run',
  ZONES_READ_ALL: 'zones:read_all',
  ZONES_RUN_ALL: 'zones:run_all',

  // Human-in-the-loop
  HITL_DECIDE: 'hitl:decide',

  // Domain actions
  FRAUD_REVIEW: 'fraud:review',
  RULES_READ: 'rules:read',
  RULES_PUBLISH: 'rules:publish',
  MARKET_MANAGE: 'market:manage',
  LAB_EXPERIMENT: 'lab:experiment',

  // SRE
  OBSERVABILITY_READ: 'observability:read',
  INCIDENTS_MANAGE: 'incidents:manage',
  POSTMORTEMS_CREATE: 'postmortems:create',
  BOT_READ: 'bot:read',

  // LiveOps
  LIVEOPS_READ: 'liveops:read',
  LIVEOPS_MAINTENANCE: 'liveops:maintenance',
  LIVEOPS_PUSH: 'liveops:push',
  LIVEOPS_NEWS: 'liveops:news',
  LIVEOPS_TICKETS: 'liveops:tickets',
  LIVEOPS_FEEDBACK: 'liveops:feedback',
  LIVEOPS_PATCHES: 'liveops:patches',

  // Privacy & legal
  PLAYERS_READ: 'players:read',
  PLAYERS_EXPORT: 'players:export',
  PLAYERS_ERASE: 'players:erase',
  PLAYERS_SANCTION: 'players:sanction',
  LEGAL_READ: 'legal:read',

  // Governance & platform
  GOVERNANCE_READ: 'governance:read',
  AI_CONFIGURE: 'ai:configure',
  AUDIT_READ: 'audit:read',
  AUDIT_VERIFY: 'audit:verify',
  SYSTEM_READ: 'system:read',
  SYSTEM_BACKUP: 'system:backup',
  SYSTEM_RETENTION: 'system:retention',
  SCHEDULER_READ: 'scheduler:read',
  SCHEDULER_MANAGE: 'scheduler:manage',
  EXPORTS_READ: 'exports:read',
  SESSIONS_MANAGE: 'sessions:manage',
  USERS_MANAGE: 'users:manage',
  OBSERVABILITY_MANAGE: 'observability:manage',
});

const P = PERMISSIONS;

const ZONE_READ = Object.freeze({
  ops: [P.ZONE_OPS_READ, P.ZONES_READ_ALL],
  fraud: [P.ZONE_FRAUD_READ, P.ZONES_READ_ALL],
  balance: [P.ZONE_BALANCE_READ, P.ZONES_READ_ALL],
  market: [P.ZONE_MARKET_READ, P.ZONES_READ_ALL],
  lab: [P.ZONE_LAB_READ, P.ZONES_READ_ALL],
});

const ZONE_RUN = Object.freeze({
  ops: [P.ZONE_OPS_RUN, P.ZONES_RUN_ALL],
  fraud: [P.ZONE_FRAUD_RUN, P.ZONES_RUN_ALL],
  balance: [P.ZONE_BALANCE_RUN, P.ZONES_RUN_ALL],
  market: [P.ZONE_MARKET_RUN, P.ZONES_RUN_ALL],
  lab: [P.ZONE_LAB_RUN, P.ZONES_RUN_ALL],
});

const ADMIN_ALL = Object.freeze([
  P.DASHBOARD_READ,
  P.SEARCH_GLOBAL,
  P.NOTIFICATIONS_READ,
  P.DIRECTOR_READ,
  P.DIRECTOR_CHAT,
  P.DIRECTOR_PRIORITIES,
  P.DIRECTOR_ARCHIVE,
  P.ZONES_READ_ALL,
  P.ZONES_RUN_ALL,
  // Explicit per-zone grants keep route-level checks uniform (`guard(P.ZONE_LAB_RUN)`)
  P.ZONE_OPS_READ,
  P.ZONE_OPS_RUN,
  P.ZONE_FRAUD_READ,
  P.ZONE_FRAUD_RUN,
  P.ZONE_BALANCE_READ,
  P.ZONE_BALANCE_RUN,
  P.ZONE_MARKET_READ,
  P.ZONE_MARKET_RUN,
  P.ZONE_LAB_READ,
  P.ZONE_LAB_RUN,
  P.HITL_DECIDE,
  P.FRAUD_REVIEW,
  P.RULES_READ,
  P.RULES_PUBLISH,
  P.MARKET_MANAGE,
  P.LAB_EXPERIMENT,
  P.OBSERVABILITY_READ,
  P.INCIDENTS_MANAGE,
  P.POSTMORTEMS_CREATE,
  P.BOT_READ,
  P.LIVEOPS_READ,
  P.LIVEOPS_MAINTENANCE,
  P.LIVEOPS_PUSH,
  P.LIVEOPS_NEWS,
  P.LIVEOPS_TICKETS,
  P.LIVEOPS_FEEDBACK,
  P.LIVEOPS_PATCHES,
  P.PLAYERS_READ,
  P.PLAYERS_EXPORT,
  P.PLAYERS_ERASE,
  P.PLAYERS_SANCTION,
  P.LEGAL_READ,
  P.GOVERNANCE_READ,
  P.AI_CONFIGURE,
  P.AUDIT_READ,
  P.AUDIT_VERIFY,
  P.SYSTEM_READ,
  P.SYSTEM_BACKUP,
  P.SYSTEM_RETENTION,
  P.SCHEDULER_READ,
  P.SCHEDULER_MANAGE,
  P.EXPORTS_READ,
  P.SESSIONS_MANAGE,
  P.USERS_MANAGE,
  P.OBSERVABILITY_MANAGE,
]);

const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.PLAYER]: ['client:play', 'client:telemetry', 'client:support', 'client:privacy'],
  [ROLES.ADMIN]: ADMIN_ALL,
  [ROLES.AI_ZONE_OPS]: [P.ZONE_OPS_READ, P.ZONE_OPS_RUN, P.NOTIFICATIONS_READ],
  [ROLES.AI_ZONE_FRAUD]: [P.ZONE_FRAUD_READ, P.ZONE_FRAUD_RUN, P.NOTIFICATIONS_READ],
  [ROLES.AI_ZONE_BALANCE]: [P.ZONE_BALANCE_READ, P.ZONE_BALANCE_RUN, P.NOTIFICATIONS_READ, P.RULES_READ],
  [ROLES.AI_ZONE_MARKET]: [P.ZONE_MARKET_READ, P.ZONE_MARKET_RUN, P.NOTIFICATIONS_READ],
  [ROLES.AI_ZONE_LAB]: [P.ZONE_LAB_READ, P.ZONE_LAB_RUN, P.NOTIFICATIONS_READ, P.EXPORTS_READ],
  [ROLES.AI_DIRECTOR]: [P.DIRECTOR_READ, P.SEARCH_GLOBAL, P.NOTIFICATIONS_READ],
});

function permissionsForRole(role) {
  return ROLE_PERMISSIONS[role] ? [...ROLE_PERMISSIONS[role]] : [];
}

function hasPermission(role, permission) {
  const list = ROLE_PERMISSIONS[role];
  return Array.isArray(list) && list.includes(permission);
}

function hasAny(role, permissions) {
  return permissions.some((p) => hasPermission(role, p));
}

function canReadZone(role, zone) {
  return hasAny(role, ZONE_READ[zone] || []);
}

function canRunZone(role, zone) {
  return hasAny(role, ZONE_RUN[zone] || []);
}

/**
 * Route guard helper. Returns `null` when allowed, otherwise a ready-to-send 403 body.
 */
function deny(role, permission) {
  if (hasPermission(role, permission)) return null;
  return {
    status: 403,
    json: {
      error: 'FORBIDDEN_RBAC',
      permission,
      role,
      message: `Роль «${role}» не имеет права «${permission}»`,
    },
  };
}

function denyZoneRead(role, zone) {
  if (canReadZone(role, zone)) return null;
  return {
    status: 403,
    json: { error: 'FORBIDDEN_ZONE_ISOLATION', zone, role, message: `Нет доступа к зоне «${zone}»` },
  };
}

/**
 * UI navigation is derived from the same matrix: a tab is visible only when the
 * role holds at least one permission the tab is built on.
 */
const NAV_TABS = Object.freeze([
  { id: 'overview', label: 'Обзор', icon: 'grid', permissions: [P.DASHBOARD_READ] },
  { id: 'director', label: 'Директор', icon: 'messages', permissions: [P.DIRECTOR_READ] },
  { id: 'ops', label: 'Ops', icon: 'activity', permissions: [P.ZONE_OPS_READ, P.ZONES_READ_ALL] },
  { id: 'fraud', label: 'Fraud', icon: 'shield', permissions: [P.ZONE_FRAUD_READ, P.ZONES_READ_ALL] },
  { id: 'balance', label: 'Balance', icon: 'target', permissions: [P.ZONE_BALANCE_READ, P.ZONES_READ_ALL] },
  { id: 'market', label: 'Market', icon: 'trending', permissions: [P.ZONE_MARKET_READ, P.ZONES_READ_ALL] },
  { id: 'lab', label: 'Lab', icon: 'flask', permissions: [P.ZONE_LAB_READ, P.ZONES_READ_ALL] },
  { id: 'observability', label: 'Наблюдаемость', icon: 'pulse', permissions: [P.OBSERVABILITY_READ] },
  { id: 'liveops', label: 'LiveOps', icon: 'rocket', permissions: [P.LIVEOPS_READ] },
  { id: 'players', label: 'Игроки', icon: 'users', permissions: [P.PLAYERS_READ, P.LEGAL_READ] },
  { id: 'governance', label: 'Управление', icon: 'lock', permissions: [P.GOVERNANCE_READ, P.AUDIT_READ, P.SYSTEM_READ] },
  { id: 'settings', label: 'Настройки', icon: 'sliders', permissions: [P.SYSTEM_READ, P.SCHEDULER_READ, P.SESSIONS_MANAGE] },
]);

function navigationForRole(role) {
  return NAV_TABS.filter((tab) => hasAny(role, tab.permissions)).map((t) => ({ ...t }));
}

module.exports = {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ZONE_READ,
  ZONE_RUN,
  NAV_TABS,
  permissionsForRole,
  hasPermission,
  hasAny,
  canReadZone,
  canRunZone,
  deny,
  denyZoneRead,
  navigationForRole,
};
