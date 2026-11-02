/* FORMA MUN · Crisis Division — Admin: server access and shared state
   The password is checked on the server and never appears here. The session token lives in
   sessionStorage (cleared when the tab closes). Every admin module hangs off F.Admin. */
(function (F) {
  'use strict';
  const { CONFIG, session } = F;

  const A = F.Admin = {
    status: null,        // last /api/admin?action=status response
    clockOffset: 0,      // server time minus browser time
    content: {},         // scenario document being edited
    site: {},            // public text being edited: { "rules.roll-call": "…" }
    contentReady: false, // true once the server's content (or its absence) is confirmed
    dirty: false,        // editor has changes that are not saved anywhere yet
    now() { return Date.now() + this.clockOffset; },
    token() { return session.get('adminToken', null); }
  };

  async function call(endpoint, action, opts = {}) {
    const query = action ? '?action=' + action + '&t=' + Date.now() : '?t=' + Date.now();
    const token = A.token();
    const headers = Object.assign({ Accept: 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}, opts.headers || {});
    const res = await fetch(endpoint + query + (opts.query || ''), Object.assign({ cache: 'no-store', headers }, opts.init || {}));
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    // A wrong password also answers 401, but there is no token yet then.
    if (res.status === 401 && A.token() && A.logout) A.logout('SESSION EXPIRED · LOG IN AGAIN');
    return { res, data };
  }
  const postOpts = (body) => ({ init: { method: 'POST', body: JSON.stringify(body || {}) }, headers: { 'Content-Type': 'application/json' } });

  A.get = (action, opts) => call(CONFIG.adminEndpoint, action, opts);
  A.post = (action, body) => call(CONFIG.adminEndpoint, action, postOpts(body));
  A.committeeGet = () => call(CONFIG.committeeEndpoint, '');
  A.committeeDelegates = () => call(CONFIG.committeeEndpoint, 'delegates');
  // Every chair action says who did it, for the activity log.
  const signed = (body) => Object.assign({ actor: session.get('chairName', '') }, body);
  A.committeePost = (action, body) => call(CONFIG.committeeEndpoint, action, postOpts(signed(body)));
  A.crisisGet = (action, opts) => call(CONFIG.crisisEndpoint, action, opts);
  A.crisisPost = (action, body) => call(CONFIG.crisisEndpoint, action, postOpts(signed(body)));
  A.login = (username, password) => call(CONFIG.adminEndpoint, 'login', postOpts({ username, password }));

  // Modules register here so one can react to another without importing it.
  A.onLogout = [];
  A.onPanel = {};
})(window.FORMA = window.FORMA || {});
