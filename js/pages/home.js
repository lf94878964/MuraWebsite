import { subscribe } from '../core/stats.js';
import { animateTo, fmt } from '../core/format.js';

export function mount(root) {
  const guilds = root.querySelector('#stat-guilds');
  const users = root.querySelector('#stat-users');
  const commands = root.querySelector('#stat-commands');
  const dot = root.querySelector('#live-dot');
  const state = root.querySelector('#live-state');
  const version = root.querySelector('#live-version');

  return subscribe((data, err) => {
    if (!data) {
      if (err && state) state.textContent = '連線失敗';
      return;
    }
    if (guilds) guilds.textContent = fmt(data.guilds);
    if (users && data.user_total != null) animateTo(users, data.user_total);
    if (commands && data.command != null) animateTo(commands, data.command);

    const online = String(data.status || '').toLowerCase() === 'online';
    if (dot) dot.className = 'status-dot ' + (online ? 'online' : 'offline');
    if (state) state.textContent = online ? '運行中' : data.status || '未知';
    if (version) version.textContent = data.version ? `v${String(data.version).replace(/^v/i, '')}` : '—';
  });
}
