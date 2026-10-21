(function () {
  'use strict';

  // Theme: follow the OS unless the visitor chose one.
  try {
    var saved = localStorage.getItem('xctl-theme');
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch (_) {
    /* private mode */
  }

  var toggle = document.querySelector('.theme-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme');
      var prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
      var next = current ? (current === 'dark' ? 'light' : 'dark') : prefersLight ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      try {
        localStorage.setItem('xctl-theme', next);
      } catch (_) {
        /* private mode */
      }
    });
  }

  document.querySelectorAll('[data-copy]').forEach(function (button) {
    button.addEventListener('click', function () {
      var text = button.getAttribute('data-copy') || '';
      var done = function () {
        var previous = button.textContent;
        button.textContent = 'Copied';
        button.classList.add('done');
        window.setTimeout(function () {
          button.textContent = previous;
          button.classList.remove('done');
        }, 1600);
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {
          window.prompt('Copy this command:', text);
        });
      } else {
        window.prompt('Copy this command:', text);
      }
    });
  });
})();
