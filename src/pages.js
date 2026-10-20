/**
 * The tiny page Google redirects back to after sign-in.
 * Popup flow: hands the result to the opener, restricted to the verified origin.
 * Redirect flow (popup blocked / mobile): returns to the app with the result in the URL fragment.
 */

/** JSON that is safe to inline inside a <script> element. */
function inlineJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function authResultPage({ origin, returnTo, message }) {
  const title = message.type === 'AUTH_SUCCESS' ? 'החיבור הצליח' : 'החיבור נכשל';
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Drive Pro – ${title}</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f8fafc;color:#0f172a}</style></head>
<body><p>${title}. ניתן לסגור את החלון.</p>
<script>
(function () {
  var message = ${inlineJson(message)};
  var origin = ${inlineJson(origin)};
  var returnTo = ${inlineJson(returnTo || '')};
  try {
    if (origin && window.opener && !window.opener.closed) {
      window.opener.postMessage(message, origin);
      window.close();
      return;
    }
  } catch (e) {}
  if (returnTo) {
    var payload = btoa(unescape(encodeURIComponent(JSON.stringify(message))));
    location.replace(returnTo.split('#')[0] + '#auth=' + encodeURIComponent(payload));
  }
})();
</script>
</body></html>`;
}
