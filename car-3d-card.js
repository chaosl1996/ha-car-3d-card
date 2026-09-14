/**
 * car-3d-card 引导加载器
 * 本体代码在同目录 car-3d-card.impl.js，运行时带时间戳动态加载。
 * 本文件内容永久不变 → 资源 URL 被 HA 缓存 31 天也无妨；
 * 卡片更新只需替换 impl 文件，页面刷新即生效，无需再改资源版本号。
 */
(function () {
  'use strict';
  var base = '';
  try { base = document.currentScript.src; } catch (e) {}
  if (!base) {
    var s = document.querySelector('script[src*="car-3d-card.js"]');
    base = s ? s.src : '';
  }
  var dir = base.replace(/car-3d-card\.js.*$/, '');
  var url = dir + 'car-3d-card.impl.js?v=' + Date.now();
  try {
    // 同步获取本体并同步执行，保证自定义元素在资源加载完成时即已注册（避免竞态）
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, false);
    xhr.send();
    if (xhr.status !== 200) throw new Error('HTTP ' + xhr.status);
    var script = document.createElement('script');
    script.textContent = xhr.responseText;
    (document.head || document.documentElement).appendChild(script);
  } catch (err) {
    console.error('[car-3d-card] 加载本体失败：', err);
  }
})();
