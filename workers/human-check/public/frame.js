/* Cloudflare Turnstile host for Mummer. Runs on its own origin, embedded by the app. It talks to the app only through postMessage,
   and only ever to the parent origin named in the page's own <meta name="mummer-parent-origin"> (set by the Worker). */
(function () {
  'use strict';
  var parentOrigin = (document.querySelector('meta[name="mummer-parent-origin"]') || {}).content || '';
  var params = new URLSearchParams(window.location.search);
  var sitekey = params.get('sitekey') || '';
  var send = function (message) {
    // With no configured parent there is nobody safe to talk to.
    if (!parentOrigin) return;
    window.parent.postMessage(Object.assign({ source: 'mummer-human-check' }, message), parentOrigin);
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
