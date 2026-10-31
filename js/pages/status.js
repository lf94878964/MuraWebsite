import { subscribe, refresh } from '../core/stats.js';
import { animateTo, fmt } from '../core/format.js';

// 這些欄位不使用中文單位縮寫（數字小或非數值）
const NO_ABBR = new Set(['sd-guilds', 'sd-command-count']);
// 這些欄位直接顯示、不做動畫
const PLAIN = new Set(['sd-restart']);

export function mount(root) {
  const $ = (id) => root.querySelector('#' + id);
  const text = (id, v) => {
    const el = $(id);
    if (el) el.textContent = v;
  };

  const show = (which) => {
    $('status-loading').style.display = which === 'loading' ? '' : 'none';
    $('status-error').style.display = which === 'error' ? 'flex' : 'none';
    $('status-grid').style.display = which === 'data' ? '' : 'none';
  };

  const render = (d) => {
    const online = String(d.status || '').toLowerCase() === 'online';
    $('status-dot').className = 'status-dot ' + (online ? 'online' : 'offline');
    text('status-badge-text', online ? '運行中' : d.status || '未知');
    if (d.last_update) {
      text('status-last-update', '最後更新　' + new Date(d.last_update * 1000).toLocaleString('zh-TW', { hour12: false }));
    }
    text('status-version', '版本　' + (d.version || '—'));

    const av = $('sd-avatar');
    av.src = d.bot_avatar || '';
    av.style.display = d.bot_avatar ? '' : 'none';
    text('sd-name', d.bot_name || '—');
    text('sd-id', d.bot_id ? String(d.bot_id) : '—');

    const numeric = {
      'sd-guilds': d.guilds,
      'sd-user-total': d.user_total,
      'sd-user-guild': d.user_guild,
      'sd-user-install': d.user_install,
      'sd-command': d.command,
      'sd-command-count': d.command_count,
      'sd-restart': d.restart,
      'sd-ban-users': d.ban_users,
      'sd-ban-servers': d.ban_servers,
      'sd-total-quotes': d.total_quotes,
      'sd-yuzu-i': d.yuzu_issued,
      'sd-yuzu-b': d.yuzu_burned,
      'sd-yuzu-c': d.yuzu_circulation,
      'sd-silly-i': d.silly_issued,
      'sd-silly-b': d.silly_burned,
      'sd-silly-c': d.silly_circulation,
    };
    for (const [id, val] of Object.entries(numeric)) {
      const el = $(id);
      if (!el) continue;
      if (val == null) el.textContent = '—';
      else if (PLAIN.has(id)) el.textContent = String(val);
      else animateTo(el, val, { cn: !NO_ABBR.has(id) });
    }

    text('sd-backup', d.backup !== undefined ? fmt(d.backup) : '—');
    text('sd-shard', d.shard_info !== undefined ? String(d.shard_info) : '—');
    text('sd-backup-ver', d.backup_version || '—');
    text('sd-ver', d.version || '—');
    show('data');
  };

  let hasData = false;
  const off = subscribe((data, err) => {
    if (data) {
      hasData = true;
      render(data);
    } else if (err && !hasData) {
      text('status-error-msg', '無法取得資料：' + err.message);
      show('error');
    }
  });

  const btn = $('status-refresh-btn');
  const onRefresh = async () => {
    btn.disabled = true;
    btn.textContent = '更新中…';
    await refresh();
    btn.textContent = '已更新';
    setTimeout(() => {
      btn.textContent = '手動更新';
      btn.disabled = false;
    }, 1500);
  };
  btn.addEventListener('click', onRefresh);

  return () => {
    off();
    btn.removeEventListener('click', onRefresh);
  };
}
