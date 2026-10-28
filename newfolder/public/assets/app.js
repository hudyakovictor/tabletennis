/* TOPSPIN ARENA Admin CRM — classic bootstrap.
 * The application itself is a set of native ES modules under /assets/js/.
 * This file stays a single small classic script so the strict CSP
 * (`script-src 'self'`, zero inline scripts) is satisfied and a fatal module
 * load error still renders a human-readable message instead of a blank page.
 */
(function () {
  'use strict';

  // Apply the persisted theme before first paint to avoid a flash of the wrong palette.
  try {
    var savedTheme = localStorage.getItem('topspin_theme');
    var theme = savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (err) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }

  function fatal(message) {
    var host = document.getElementById('view') || document.body;
    var box = document.createElement('div');
    box.className = 'error-panel';
    var title = document.createElement('h4');
    title.textContent = 'Не удалось загрузить интерфейс';
    var text = document.createElement('p');
    text.textContent = message;
    var retry = document.createElement('button');
    retry.className = 'btn btn-sm';
    retry.textContent = 'Перезагрузить';
    retry.addEventListener('click', function () { location.reload(); });
    box.appendChild(title);
    box.appendChild(text);
    box.appendChild(retry);
    host.innerHTML = '';
    host.appendChild(box);
    var login = document.getElementById('login-screen');
    var app = document.getElementById('app');
    if (login) login.classList.add('hidden');
    if (app) app.classList.remove('hidden');
  }

  if (typeof window.fetch !== 'function') {
    fatal('Браузер не поддерживается: требуется современный Chromium, Safari или Firefox.');
    return;
  }

  import('./js/main.js').catch(function (err) {
    console.error('[topspin] module bootstrap failed', err);
    fatal(String((err && err.message) || err));
  });
})();
