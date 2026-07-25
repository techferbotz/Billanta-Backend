// The self-contained admin panel served at GET /admin. Vanilla JS in one template literal —
// no build step, no bundler, no external assets, so it ships inside the compiled output.
//
// Auth: the page holds NO secret. It POSTs hardcoded credentials to POST /admin/login
// (checked server-side against ADMIN_PANEL_USER/PASSWORD); on success the backend returns the
// ADMIN_API_KEY, which the page keeps in sessionStorage and sends as the Bearer on every call.
//
// MAINTENANCE NOTE: this whole file is ONE template literal and its contents are NOT
// type-checked. The client script therefore avoids backticks and the "${" sequence and uses
// single quotes for HTML fragments (double quotes for HTML attributes). Edit carefully and
// reload GET /admin to verify.
export const ADMIN_PANEL_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Billanta Admin</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: #f5f6f8; color: #14171f; }
  header { display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: #1f2430; color: #fff; }
  header h1 { font-size: 16px; margin: 0; margin-right: auto; }
  header button { background: #384152; color: #fff; }
  main { max-width: 1100px; margin: 18px auto; padding: 0 16px; }
  button { font: inherit; padding: 6px 12px; border: 0; border-radius: 6px; background: #4f86c6; color: #fff; cursor: pointer; }
  button.sec { background: #e2e6ec; color: #1f2430; }
  button.danger { background: #d9534f; }
  button.small { padding: 3px 8px; font-size: 13px; }
  input, select, textarea { font: inherit; width: 100%; padding: 7px 9px; border: 1px solid #c7ccd6; border-radius: 6px; background: #fff; color: #14171f; }
  textarea { min-height: 200px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; white-space: pre; }
  label { display: block; font-weight: 600; font-size: 13px; margin: 10px 0 3px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #eceef2; font-size: 14px; vertical-align: top; }
  th { background: #eef1f5; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; }
  .card { background: #fff; border-radius: 8px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.08); margin-bottom: 16px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .pill.Published { background: #d7f0dd; color: #1c7a37; }
  .pill.Draft { background: #fdeecf; color: #8a5a12; }
  .pill.Archived { background: #e6e6e6; color: #555; }
  .msg { padding: 8px 12px; border-radius: 6px; margin: 10px 0; display: none; white-space: pre-wrap; }
  .msg.err { display: block; background: #fbe3e2; color: #a12b28; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; }
  .msg.ok { display: block; background: #d7f0dd; color: #1c7a37; }
  .login { max-width: 340px; margin: 12vh auto; }
  .muted { color: #6a7180; font-size: 13px; }
  .toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
  .row-actions { display: flex; gap: 6px; flex-wrap: wrap; }
  pre.json { background: #0f1420; color: #d6e2f5; padding: 12px; border-radius: 8px; overflow: auto; max-height: 340px; font-size: 12px; }
</style>
</head>
<body>
<div id="root"></div>
<script>
(function () {
  'use strict';
  var KEY_STORE = 'billanta_admin_key';
  function loadKey() { try { return sessionStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } }
  function storeKey(v) { try { if (v) sessionStorage.setItem(KEY_STORE, v); else sessionStorage.removeItem(KEY_STORE); } catch (e) {} }
  var KEY = loadKey();
  var root = document.getElementById('root');
  var state = { view: 'list', templates: [], current: null };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function api(method, path, body, isForm) {
    var opts = { method: method, headers: {} };
    if (KEY) opts.headers['Authorization'] = 'Bearer ' + KEY;
    if (isForm) { opts.body = body; }
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (!res.ok || json.success === false) {
          var e = new Error((json && json.message) || ('HTTP ' + res.status));
          e.code = json && json.code; throw e;
        }
        return json.data;
      });
    });
  }

  function h(html) { var d = document.createElement('div'); d.innerHTML = html; return d; }
  function showMsg(el, text, kind) { el.className = 'msg ' + kind; el.textContent = text; }

  // ---- login ----
  function renderLogin() {
    root.innerHTML = '';
    var box = h(
      '<div class="login card">' +
      '<h1 style="margin-top:0">Billanta Admin</h1>' +
      '<label>Username</label><input id="u" autocomplete="username" />' +
      '<label>Password</label><input id="p" type="password" autocomplete="current-password" />' +
      '<div style="margin-top:14px"><button id="go">Sign in</button></div>' +
      '<div id="m" class="msg"></div>' +
      '</div>'
    );
    root.appendChild(box);
    box.querySelector('#go').onclick = function () {
      var u = box.querySelector('#u').value, p = box.querySelector('#p').value;
      api('POST', '/admin/login', { username: u, password: p }).then(function (data) {
        KEY = data.apiKey; storeKey(KEY); route('list');
      }).catch(function (e) { showMsg(box.querySelector('#m'), e.message, 'err'); });
    };
  }

  function chrome(inner) {
    return '<header><h1>Billanta Admin</h1>' +
      '<button id="nav-list" class="sec">Templates</button>' +
      '<button id="logout">Sign out</button></header><main>' + inner + '</main>';
  }

  // ---- template list ----
  function renderList() {
    api('GET', '/admin/templates').then(function (data) {
      var rows = data.items.map(function (t) {
        return '<tr><td><strong>' + esc(t.id) + '</strong><div class="muted">' + esc(t.name) + '</div></td>' +
          '<td>' + esc(t.category || '-') + '</td>' +
          '<td>' + (t.isPremium ? 'Yes' : 'No') + '</td>' +
          '<td>' + (t.isActive ? 'Active' : 'Hidden') + '</td>' +
          '<td>' + (t.currentVersionId ? 'published' : 'none') + '</td>' +
          '<td class="row-actions"><button class="small open" data-id="' + esc(t.id) + '">Open</button>' +
          '<button class="small danger del" data-id="' + esc(t.id) + '">Delete</button></td></tr>';
      }).join('');
      var body = chrome(
        '<div class="toolbar"><h2 style="margin:0;margin-right:auto">Templates</h2>' +
        '<button id="new">New template</button></div>' +
        '<div id="m" class="msg"></div>' +
        '<div class="card"><table><thead><tr><th>Id / Name</th><th>Category</th><th>Premium</th><th>State</th><th>Current</th><th></th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="6" class="muted">No templates yet.</td></tr>') + '</tbody></table></div>' +
        newTemplateForm()
      );
      root.innerHTML = body;
      wireChrome();
      Array.prototype.forEach.call(root.querySelectorAll('.open'), function (b) {
        b.onclick = function () { route('detail', b.getAttribute('data-id')); };
      });
      Array.prototype.forEach.call(root.querySelectorAll('.del'), function (b) {
        b.onclick = function () {
          if (!confirm('Delete template "' + b.getAttribute('data-id') + '" and all its versions?')) return;
          api('DELETE', '/admin/templates/' + b.getAttribute('data-id')).then(function () { renderList(); })
            .catch(function (e) { showMsg(root.querySelector('#m'), e.message, 'err'); });
        };
      });
      wireNewTemplate();
    }).catch(handleAuthError);
  }

  function newTemplateForm() {
    return '<details class="card"><summary style="cursor:pointer;font-weight:600">Create a new template</summary>' +
      '<div class="grid2" style="margin-top:12px">' +
      '<div><label>Id (slug)</label><input id="nt-id" placeholder="classic" /></div>' +
      '<div><label>Name</label><input id="nt-name" placeholder="Classic" /></div>' +
      '<div><label>Category</label><input id="nt-cat" placeholder="Business" /></div>' +
      '<div><label>Thumbnail URL</label><input id="nt-thumb" /></div>' +
      '<div><label>Premium</label><select id="nt-prem"><option value="false">No</option><option value="true">Yes</option></select></div>' +
      '<div><label>Order index</label><input id="nt-order" type="number" value="0" /></div>' +
      '</div><div style="margin-top:12px"><button id="nt-create">Create</button></div></details>';
  }

  function wireNewTemplate() {
    var btn = root.querySelector('#nt-create');
    if (!btn) return;
    btn.onclick = function () {
      var payload = {
        id: root.querySelector('#nt-id').value.trim(),
        name: root.querySelector('#nt-name').value.trim(),
        category: root.querySelector('#nt-cat').value.trim() || null,
        thumbnailUrl: root.querySelector('#nt-thumb').value.trim() || null,
        isPremium: root.querySelector('#nt-prem').value === 'true',
        orderIndex: Number(root.querySelector('#nt-order').value) || 0
      };
      api('POST', '/admin/templates', payload).then(function (t) { route('detail', t.id); })
        .catch(function (e) { showMsg(root.querySelector('#m'), e.message, 'err'); });
    };
  }

  // ---- template detail + authoring ----
  function renderDetail(id) {
    api('GET', '/admin/templates/' + id).then(function (data) {
      var t = data.template;
      var versionRows = data.versions.map(function (v) {
        return '<tr><td>#' + v.version + '</td>' +
          '<td><span class="pill ' + esc(v.status) + '">' + esc(v.status) + '</span></td>' +
          '<td class="muted">' + esc(v.checksum.slice(0, 12)) + '...</td>' +
          '<td class="row-actions"><button class="small viewv" data-v="' + v.version + '">View JSON</button>' +
          (v.status === 'Published' ? '' : '<button class="small pubv" data-v="' + v.version + '">Publish</button>') +
          '</td></tr>';
      }).join('');
      root.innerHTML = chrome(
        '<div class="toolbar"><button id="back" class="sec small">&larr; Back</button>' +
        '<h2 style="margin:0">' + esc(t.id) + '</h2>' +
        '<span class="pill ' + (t.isActive ? 'Published' : 'Archived') + '">' + (t.isActive ? 'Active' : 'Hidden') + '</span></div>' +
        '<div id="m" class="msg"></div>' +
        '<div class="card"><h3 style="margin-top:0">Author a new version</h3>' +
        '<div class="grid2">' +
        '<div><label>HTML</label><textarea id="html" placeholder="&lt;div data-page-size=&quot;A4&quot;&gt; ... &lt;/div&gt;"></textarea></div>' +
        '<div><label>CSS</label><textarea id="css" placeholder=".page { padding: 48px; }"></textarea></div>' +
        '</div>' +
        '<div style="margin-top:12px"><button id="compile">Compile &amp; save draft</button> ' +
        '<span class="muted">Compiles to Billanta Template JSON; errors show the exact line.</span></div>' +
        '<div id="cmsg" class="msg"></div>' +
        '<div id="cjson"></div></div>' +
        '<div class="card"><h3 style="margin-top:0">Versions</h3>' +
        '<table><thead><tr><th>Version</th><th>Status</th><th>Checksum</th><th></th></tr></thead>' +
        '<tbody>' + (versionRows || '<tr><td colspan="4" class="muted">No versions yet.</td></tr>') + '</tbody></table></div>'
      );
      wireChrome();
      root.querySelector('#back').onclick = function () { route('list'); };
      root.querySelector('#compile').onclick = function () { doCompile(id); };
      Array.prototype.forEach.call(root.querySelectorAll('.viewv'), function (b) {
        b.onclick = function () { viewVersion(id, b.getAttribute('data-v')); };
      });
      Array.prototype.forEach.call(root.querySelectorAll('.pubv'), function (b) {
        b.onclick = function () {
          if (!confirm('Publish version #' + b.getAttribute('data-v') + '? Published versions are immutable.')) return;
          api('POST', '/admin/templates/' + id + '/versions/' + b.getAttribute('data-v') + '/publish')
            .then(function () { route('detail', id); })
            .catch(function (e) { showMsg(root.querySelector('#m'), e.message, 'err'); });
        };
      });
    }).catch(handleAuthError);
  }

  function doCompile(id) {
    var html = root.querySelector('#html').value;
    var css = root.querySelector('#css').value;
    var cmsg = root.querySelector('#cmsg');
    var cjson = root.querySelector('#cjson');
    cmsg.className = 'msg'; cjson.innerHTML = '';
    api('POST', '/admin/templates/' + id + '/versions', { html: html, css: css }).then(function (v) {
      showMsg(cmsg, 'Compiled OK — saved as draft #' + v.version + ' (checksum ' + v.checksum.slice(0, 12) + '...)', 'ok');
      cjson.innerHTML = '<pre class="json">' + esc(JSON.stringify(v.compiled, null, 2)) + '</pre>';
      renderDetail(id);
    }).catch(function (e) { showMsg(cmsg, e.message, 'err'); });
  }

  function viewVersion(id, v) {
    api('GET', '/admin/templates/' + id + '/versions/' + v).then(function (data) {
      var w = window.open('', '_blank');
      if (w) { w.document.title = id + ' v' + v; w.document.body.style.font = '13px ui-monospace, monospace';
        w.document.body.innerHTML = '<pre>' + esc(JSON.stringify(data.compiled, null, 2)) + '</pre>'; }
    }).catch(function (e) { showMsg(root.querySelector('#m'), e.message, 'err'); });
  }

  function wireChrome() {
    var nav = root.querySelector('#nav-list'); if (nav) nav.onclick = function () { route('list'); };
    var out = root.querySelector('#logout'); if (out) out.onclick = function () { KEY = ''; storeKey(''); renderLogin(); };
  }

  function handleAuthError(e) {
    if (e && (e.message === 'Unauthorized' || /invalid admin/i.test(e.message))) { KEY = ''; storeKey(''); renderLogin(); return; }
    root.innerHTML = chrome('<div class="msg err">' + esc(e.message) + '</div>');
    wireChrome();
  }

  function route(view, arg) {
    state.view = view;
    if (!KEY) { renderLogin(); return; }
    if (view === 'list') renderList();
    else if (view === 'detail') renderDetail(arg);
  }

  if (KEY) route('list'); else renderLogin();
})();
</script>
</body>
</html>`;
