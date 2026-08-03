#!/usr/bin/env bash
# ============================================================
# 无头浏览器冒烟测试：验证 5 个页面都能被 JS 正常渲染
# 依赖：python3、Playwright 缓存里的 chrome-headless-shell
#（无需安装 playwright 包，只用其下载的浏览器二进制）
# 运行：bash test/smoke.sh   （在项目根目录）
# ============================================================
set -u
PORT="${PORT:-8799}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PARENT="$(dirname "$ROOT")"
BASE="http://localhost:${PORT}/$(basename "$ROOT")/index.html"

# 找 headless shell（版本号可能变化，取最新的一个）
BIN="$(ls -d "$HOME"/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell 2>/dev/null | sort | tail -1)"
if [ -z "$BIN" ]; then
  echo "未找到 chrome-headless-shell，请先: npx playwright install chromium --with-deps"
  exit 2
fi

# 探测的是目标 URL 而不是端口根路径——端口可能被根目录不对的服务器占着
SRV_PID=""
if [ "$(curl -s -o /dev/null -w "%{http_code}" "$BASE")" != "200" ]; then
  (cd "$PARENT" && exec python3 -m http.server "$PORT" >/dev/null 2>&1) &
  SRV_PID=$!
  trap '[ -n "$SRV_PID" ] && kill "$SRV_PID" 2>/dev/null' EXIT
  sleep 1
  if [ "$(curl -s -o /dev/null -w "%{http_code}" "$BASE")" != "200" ]; then
    echo "无法访问 $BASE —— 端口 ${PORT} 可能被其他服务占用，换个端口：PORT=8801 bash test/smoke.sh"
    exit 2
  fi
fi

fail=0

# 5 个 view 并行 dump（WSL2 下无头浏览器启动很慢，整个脚本约需 2~3 分钟）
# 注意：只 wait dump 进程的 PID——裸 wait 会连后台 http server 一起等，永远卡住
VIEWS="today train records meds learn"
DUMP_PIDS=""
for v in $VIEWS; do
  "$BIN" --headless --disable-gpu --no-sandbox --virtual-time-budget=3000 \
    --dump-dom "${BASE}?view=${v}" >"/tmp/smoke-dom-${v}.html" 2>"/tmp/smoke-err-${v}.log" &
  DUMP_PIDS="$DUMP_PIDS $!"
done
wait $DUMP_PIDS

check_view() {
  local view="$1"; shift
  for kw in "$@"; do
    if grep -q "$kw" "/tmp/smoke-dom-${view}.html"; then
      echo "PASS  [$view] $kw"
    else
      echo "FAIL  [$view] 缺少: $kw"
      fail=1
    fi
  done
  if grep -qiE "uncaught" "/tmp/smoke-err-${view}.log"; then
    echo "FAIL  [$view] 存在 JS 报错:"; grep -iE "uncaught" "/tmp/smoke-err-${view}.log" | head -3
    fail=1
  fi
}

check_view today   "今日三件事" "今日推荐训练" "测量血压"
check_view train   "当前康复阶段" "肢体运动" "十指交叉握手上举" "训练打卡记录"
check_view records "记一次血压" "导出记录给医生看"
check_view meds    "今日服药核对" "添加药物"
check_view learn   "拨打120" "防复发最重要的五件事"

# 静态资源可达性
for res in css/style.css js/data-exercises.js js/data-articles.js js/storage.js js/charts.js js/games.js manifest.json icon.svg; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT}/$(basename "$ROOT")/${res}")
  if [ "$code" = "200" ]; then echo "PASS  [asset] ${res}"; else echo "FAIL  [asset] ${res} -> ${code}"; fail=1; fi
done

if [ "$fail" = "0" ]; then echo "✅ 冒烟测试全部通过"; else echo "❌ 存在失败项"; fi
exit "$fail"
