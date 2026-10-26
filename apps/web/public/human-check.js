/* Isolated Cloudflare Turnstile host. Runs in a sandboxed (opaque-origin) iframe; talks to the app only via postMessage. */
(function () {
  'use strict';
  var params = new URLSearchParams(window.location.search);
  var sitekey = params.get('sitekey') || '';
  var send = function (message) {
    // The opaque origin cannot name the parent's origin; the parent verifies event.source instead.
    window.parent.postMessage(Object.assign({ source: 'mummer-human-check' }, message), '*');
  };

  if (!/^[0-9A-Za-z_-]{8,64}$/.test(sitekey)) {
    send({ type: 'error', reason: 'missing-sitekey' });
    return;
  }

  window.onTurnstileLoaded = function () {
    try {
      window.turnstile.render('#widget', {
        sitekey: sitekey,
        theme: 'light',
        callback: function (token) {
          send({ type: 'token', token: token });
        },
        'expired-callback': function () {
          send({ type: 'expired' });
        },
        'error-callback': function () {
          send({ type: 'error', reason: 'widget-error' });
        },
      });
      send({ type: 'ready' });
    } catch (e) {
      send({ type: 'error', reason: 'render-failed' });
    }
  };

  var s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoaded';
  s.async = true;
  s.onerror = function () {
    send({ type: 'error', reason: 'script-blocked' });
  };
  document.head.appendChild(s);
})();
