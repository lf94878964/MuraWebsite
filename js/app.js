// index.html 的進入點：建立共用外殼，啟動中控路由。
import { mountChrome } from './core/layout.js';
import { start, go } from './core/router.js';

const chrome = mountChrome({
  active: null,
  spa: true,
  onNavigate: (key) => go(key),
});

start({ onRoute: (key) => chrome.setActive(key) });
