'use strict';

/**
 * Static contract tests (no server, no browser).
 *
 * They guard the failure modes that never throw at runtime and therefore survive
 * every "it renders" demo review:
 *   1. the SPA gates an action on a permission the server never grants
 *      → the button silently returns "Недостаточно прав";
 *   2. the SPA calls an endpoint/verb the API does not serve → a 404 toast;
 *   3. a click handler is bound to a `data-*` attribute nobody renders
 *      → the button does nothing;
 *   4. the SPA references a DOM id that index.html does not define
 *      → an exception swallowed by the click handler;
 *   5. the router and the server-side tab catalogue diverge.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { PERMISSIONS, NAV_TABS } = require('../src/security/permissions');

const ROOT = path.resolve(__dirname, '..');
const SPA_DIR = path.join(ROOT, 'public/assets/js');
const ROUTE_FILES = [
  'src/routes/adminRoutes.js',
  'src/routes/platformRoutes.js',
  'src/routes/clientRoutes.js',
  'src/server.js',
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const spaFiles = walk(SPA_DIR);
const read = (file) => fs.readFileSync(file, 'utf8');
const rel = (file) => path.relative(ROOT, file);

/* -------------------------------------------------------------------------- */
/* Route table                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Rebuilds a checkable route table from the source:
 *   - `pathname === '/api/…'`            → verb from the same line, else ANY
 *   - `const m = pathname.match(/…/)`    → verb from `method === 'X' && m`
 */
function parseRoutes() {
  const routes = [];
  for (const relPath of ROUTE_FILES) {
    const lines = read(path.join(ROOT, relPath)).split('\n');
    const symbols = new Map(); // symbol → route entry, for deferred verb binding

    for (const line of lines) {
      const verbHere = (line.match(/method\s*===\s*'(GET|POST|PUT|PATCH|DELETE)'/) || [])[1] || null;

      const exact = line.match(/pathname\s*===\s*'([^']+)'/);
      if (exact) {
        routes.push({ verb: verbHere || 'ANY', literal: exact[1], file: relPath });
        continue;
      }

      const named = line.match(/const\s+(\w+)\s*=\s*pathname\.match\(\s*\/(.+)\/\s*\)/);
      if (named) {
        try {
          const entry = { verb: verbHere || 'ANY', regex: new RegExp(named[2]), file: relPath };
          routes.push(entry);
          symbols.set(named[1], entry);
        } catch {
          /* regexes interpolated at runtime are out of scope */
        }
      }
    }

    // Bind verbs to named matches: `if (req.method === 'POST' && incMatch) {`
    for (const line of lines) {
      const bound = line.match(/method\s*===\s*'(GET|POST|PUT|PATCH|DELETE)'[\s\S]*?&&\s*(\w+)/);
      if (bound && symbols.has(bound[2]) && symbols.get(bound[2]).verb === 'ANY') {
        symbols.get(bound[2]).verb = bound[1];
      }
    }
  }
  return routes;
}

function spaApiCalls() {
  const calls = [];
  for (const file of spaFiles) {
    const src = read(file);
    for (const m of src.matchAll(/api\.(get|post|put|patch|delete)\(\s*(['"`])([\s\S]*?)\2/g)) {
      if (m[3].includes('${')) continue;
      calls.push({ file: rel(file), verb: m[1].toUpperCase(), url: m[3] });
    }
  }
  return calls;
}

/* -------------------------------------------------------------------------- */
/* 1. Permission drift                                                        */
/* -------------------------------------------------------------------------- */

test('every permission the SPA gates on exists in the server catalogue', () => {
  const known = new Set(Object.values(PERMISSIONS));
  const drift = [];
  for (const file of spaFiles) {
    for (const m of read(file).matchAll(/can\(\s*'([^']+)'\s*\)/g)) {
      if (!known.has(m[1])) drift.push(`${rel(file)}: can('${m[1]}')`);
    }
  }
  assert.deepEqual(drift, [], `SPA checks permissions the server never grants:\n${drift.join('\n')}`);
});

/* -------------------------------------------------------------------------- */
/* 2. Endpoint drift                                                          */
/* -------------------------------------------------------------------------- */

test('every literal SPA API call resolves to an existing route and verb', () => {
  const routes = parseRoutes();
  assert.ok(routes.length > 70, `route parser only found ${routes.length} routes — it probably broke`);

  const unresolved = [];
  for (const call of spaApiCalls()) {
    const clean = call.url.split('?')[0];
    const ok = routes.some((route) => {
      if (route.verb !== 'ANY' && call.verb !== route.verb) return false;
      return route.literal ? route.literal === clean : route.regex.test(clean);
    });
    if (!ok) unresolved.push(`${call.verb} ${clean} (${call.file})`);
  }
  const unique = Array.from(new Set(unresolved));
  assert.deepEqual(unique, [], `SPA calls routes the API does not serve:\n${unique.join('\n')}`);
});

/* -------------------------------------------------------------------------- */
/* 3. Dead data-* handlers                                                    */
/* -------------------------------------------------------------------------- */

test('every data-* click handler has a rendered target it can be imported from', () => {
  // data-* markup may live in a shared component (table() emits data-key), so the
  // search space for one view is: that view, every core module, and every view it imports.
  const coreSource = spaFiles
    .filter((f) => f.includes(`${path.sep}core${path.sep}`))
    .map(read)
    .join('\n');

  const orphaned = [];
  for (const file of spaFiles.filter((f) => f.includes(`${path.sep}views${path.sep}`))) {
    const src = read(file);
    const imported = Array.from(src.matchAll(/from\s+'\.\/([a-zA-Z0-9_-]+)\.js'/g)).map((m) =>
      path.join(path.dirname(file), `${m[1]}.js`)
    );
    const searchable = [src, coreSource, ...imported.map((f) => (fs.existsSync(f) ? read(f) : ''))].join('\n');

    const bound = new Set(
      Array.from(src.matchAll(/run\([^,]+,\s*'\[data-([a-z0-9-]+)\]/g)).map((m) => m[1])
    );
    for (const attr of bound) {
      if (!new RegExp(`data-${attr}=`).test(searchable)) {
        orphaned.push(`${rel(file)}: [data-${attr}] has no rendered target`);
      }
    }
  }
  assert.deepEqual(orphaned, [], `dead click handlers:\n${orphaned.join('\n')}`);
});

/* -------------------------------------------------------------------------- */
/* 4. Dead DOM ids                                                            */
/* -------------------------------------------------------------------------- */

test('every id the SPA queries exists in the shell markup or is rendered by the SPA', () => {
  const shell = read(path.join(ROOT, 'public/index.html'));
  const spaSource = spaFiles.map(read).join('\n');
  const missing = [];

  for (const file of spaFiles) {
    const src = read(file);
    const ids = new Set(
      Array.from(src.matchAll(/qs\('#([a-zA-Z0-9_-]+)'\)/g)).map((m) => m[1])
    );
    for (const id of ids) {
      const inShell = new RegExp(`id="${id}"`).test(shell);
      const rendered = new RegExp(`id="${id}"`).test(spaSource);
      if (!inShell && !rendered) missing.push(`${rel(file)}: #${id}`);
    }
  }
  assert.deepEqual(missing, [], `SPA queries DOM ids that never exist:\n${missing.join('\n')}`);
});

/* -------------------------------------------------------------------------- */
/* 5. Navigation parity                                                       */
/* -------------------------------------------------------------------------- */

test('SPA navigation matches the server-side tab catalogue', () => {
  const mainSrc = read(path.join(SPA_DIR, 'main.js'));
  const start = mainSrc.indexOf('const VIEWS');
  const block = mainSrc.slice(start, mainSrc.indexOf('};', start));
  const uiTabs = Array.from(block.matchAll(/^\s{2}([a-z]+):\s*\{/gm)).map((m) => m[1]);
  const serverTabs = NAV_TABS.map((t) => t.id);
  assert.deepEqual(uiTabs.sort(), serverTabs.sort(), 'SPA views and NAV_TABS diverged');
});
