/* ============================================================
   打不开时的兜底页（本文件必须是 ES5，并且最后一个加载）
   主程序在太旧的浏览器里会解析失败，以前的表现是整页空白——老人只会以为
   "坏了"、反复点也没反应。这里在页面加载完后检查主程序有没有起来
   （App 未定义，或初始化半路出错、页面仍是空的），没起来就显示一句人话，
   并且**急救拨号照样能用**：急救不能依赖主程序。

   只许用 var / function / 字符串拼接：箭头函数、模板字符串、let/const 在最老的
   浏览器里都会让这个文件本身也解析失败（contracts 测试钉了这条）。
   ============================================================ */
(function () {
  function befastList() {
    var html = '';
    try {   // BEFAST 来自 data-articles.js；那个文件在更老的浏览器里也可能没加载起来
      if (typeof BEFAST !== 'undefined') {
        for (var i = 0; i < BEFAST.length; i++) {
          html += '<li><b>' + BEFAST[i].name + '</b>：' + BEFAST[i].desc + '</li>';
        }
      }
    } catch (e) { html = ''; }
    return html
      ? '<ul style="padding-left:1.3rem">' + html + '</ul>'
      : '<p>口角歪斜 · 一侧手脚无力 · 说话不清 · 突然看不清 · 走不稳</p>';
  }

  function show() {
    var view = document.getElementById('view');
    if (!view) return;
    document.body.className += ' app-failed';
    view.innerHTML =
      '<div class="card" role="alert">' +
        '<h1 class="card-title">这个浏览器打不开本应用</h1>' +
        '<p>多半是浏览器版本太旧。可以这样试：</p>' +
        '<ul style="padding-left:1.3rem">' +
          '<li>换用手机里别的浏览器打开这个网址（比如手机自带的浏览器，或在微信里打开）；</li>' +
          '<li>请家人帮忙把手机系统或浏览器更新一下。</li>' +
        '</ul>' +
        '<p class="muted">之前在这个浏览器里记的内容还保存在这里，没有丢。</p>' +
      '</div>' +
      '<div class="card" style="border:2px solid #B62828">' +
        '<h2 class="card-title" style="color:#B62828">出现这些情况，立即拨打 120</h2>' +
        befastList() +
        '<a class="call-120" href="tel:120">📞 立即拨打 120</a>' +
        '<p class="muted">点了没反应时，请用手机直接拨打 120。</p>' +
      '</div>';
  }

  function check() {
    var view = document.getElementById('view');
    if (typeof App === 'undefined' || !view || !view.children.length) show();
  }

  if (document.readyState === 'complete') check();
  else window.addEventListener('load', check);
})();
