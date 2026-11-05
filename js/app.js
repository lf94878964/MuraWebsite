// index.html 的進入點：建立共用外殼，啟動中控路由。
import { mountChrome } from './core/layout.js';
import { start, go } from './core/router.js';
import { ROUTES } from './config.js';
import { initFx } from './core/fx.js';

const chrome = mountChrome({
  active: null,
  spa: true,
  onNavigate: (key) => go(key),
});

const fx = initFx({ go });

start({
  onRoute: (key) => {
    chrome.setActive(ROUTES[key]?.nav || key, key);
    fx.refresh();
  },
});
