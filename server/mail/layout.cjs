/**
 * Branded email layout + safe template rendering.
 * Templates use {{variable}} placeholders. Values are HTML-escaped; only the layout and the
 * admin-edited template body (staff-only, sanitised on save) are trusted HTML.
 */
const escapeHtml = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function render(str, vars, { html = true } = {}) {
  return String(str).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => (html ? escapeHtml(vars[k]) : String(vars[k] ?? '')));
}

function layout({ appUrl, bodyHtml, preheader = '' }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SCHLUSS</title></head>
<body style="margin:0;padding:0;background:#EEF1F6;font-family:Arial,Helvetica,sans-serif;color:#0A0D13;">
<span style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF1F6;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;">
<tr><td style="background:#1F2B45;padding:22px 28px;"><img src="${appUrl}/brand/schluss-logo-dark.png" alt="SCHLUSS" width="170" style="display:block;border:0;height:auto;"></td></tr>
<tr><td style="height:4px;background:#3282F6;line-height:4px;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:32px 28px;font-size:15px;line-height:1.6;">${bodyHtml}</td></tr>
<tr><td style="padding:20px 28px;background:#F6F8FB;font-size:12px;line-height:1.5;color:#5B6475;">
SCHLUSS &middot; The last piece of the puzzle<br>
<a href="${appUrl}" style="color:#3282F6;text-decoration:none;">${appUrl.replace(/^https?:\/\//, '')}</a> &middot;
<a href="${appUrl}/privacy" style="color:#3282F6;text-decoration:none;">Privacy policy</a>
</td></tr></table></td></tr></table></body></html>`;
}

const button = (href, label) =>
  `<p style="margin:28px 0;"><a href="${href}" style="background:#3282F6;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block;">${label}</a></p>`;

module.exports = { escapeHtml, render, layout, button };
