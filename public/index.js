'use strict';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function timeAgo(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function render(d) {
  document.title = d.name + ' — dial in';
  $('brandMark').textContent = d.name;
  $('logo').textContent = d.name;
  $('tagline').textContent = (d.tagline || '').toUpperCase();
  $('brandSub').textContent = `14400 BAUD · ${d.maxNodes} NODES · ONLINE`;
  $('telnetHost').textContent = d.telnet;
  $('telnetLine').textContent = d.telnet;
  $('nodeLine').textContent = `${d.online} in use / ${d.maxNodes}`;
  $('sysopLine').textContent = d.sysop;
  $('locLine').textContent = d.location;
  $('softLine').textContent = d.software;
  $('statCalls').textContent = d.stats.calls.toLocaleString();
  $('statUsers').textContent = d.stats.users;
  $('statPosts').textContent = d.stats.posts;
  $('statFiles').textContent = d.stats.files;
  $('onair').textContent = `${d.online} node${d.online === 1 ? '' : 's'} online`;
  $('footNote').textContent = `${d.name} · ANSI colour required · 80 columns · 8-N-1`;

  const who = (d.nodes || []).filter((n) => n.kind !== 'phantom' || true);
  $('whoList').innerHTML = who.length
    ? who
        .map(
          (n) =>
            `<div class="row"><span class="who">${esc(n.handle)}${n.bot ? ' <span class="meta">[bot]</span>' : ''}</span><span class="meta">node ${n.node} · ${esc(n.activity)}</span></div>`
        )
        .join('')
    : '<div class="meta">Nobody on. Be the first caller.</div>';

  $('callerList').innerHTML = (d.callers || []).length
    ? d.callers
        .map(
          (c) =>
            `<div class="row"><span class="who">${esc(c.handle)}</span><span class="meta">${esc(c.location || 'unknown')} · ${timeAgo(c.when)}</span></div>`
        )
        .join('')
    : '<div class="meta">No calls logged yet.</div>';

  $('chatLog').innerHTML = (d.chat || []).length
    ? d.chat.map((c) => `<div class="chatline"><b>${esc(c.from)}</b>: ${esc(c.text)}</div>`).join('')
    : '<div class="meta">The chat room is quiet. That never lasts.</div>';

  $('telnetCopy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(`telnet ${d.telnet}`);
      $('telnetCopy').textContent = 'copied';
      setTimeout(() => {
        $('telnetCopy').innerHTML = `telnet <span id="telnetHost">${esc(d.telnet)}</span>`;
      }, 1500);
    } catch {
      /* clipboard blocked, no drama */
    }
  };
}

async function poll() {
  try {
    const res = await fetch('/api/status', { cache: 'no-store' });
    if (res.ok) render(await res.json());
  } catch {
    $('onair').textContent = 'board unreachable';
  }
  setTimeout(poll, 5000);
}

$('year').textContent = '1993–' + new Date().getFullYear();
poll();
