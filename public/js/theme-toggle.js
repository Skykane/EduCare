// Unified light / dark theme toggle. Works on every page that renders
// views/partials/theme-toggle.ejs.
(function () {
  'use strict';
  var STORAGE_KEY = 'educare-theme';
  var root = document.documentElement;

  function isDark() {
    return root.getAttribute('data-theme') === 'dark';
  }

  function sync() {
    // The button describes the action, i.e. switching to the opposite theme.
    var label = isDark() ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    document.querySelectorAll('.theme-toggle-btn').forEach(function (btn) {
      btn.setAttribute('title', label);
      btn.setAttribute('aria-label', label);
    });
  }

  function apply(theme) {
    if (theme === 'dark') root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (err) {}
    sync();
  }

  function init() {
    document.querySelectorAll('.theme-toggle-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        apply(isDark() ? 'light' : 'dark');
      });
    });

    // Keep other open tabs / windows in sync with the same preference.
    window.addEventListener('storage', function (e) {
      if (e.key !== STORAGE_KEY) return;
      if (e.newValue === 'dark') root.setAttribute('data-theme', 'dark');
      else if (e.newValue === 'light') root.removeAttribute('data-theme');
      sync();
    });

    sync();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
