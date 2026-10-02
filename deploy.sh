#!/usr/bin/env bash
# 一键部署到 Cloudflare Pages（零构建，直传静态文件）
# 依赖：wrangler（全局装了就用全局，否则回落 npx wrangler@latest）
#       须已登录：wrangler login / npx wrangler login（交互式，本脚本不代劳）
# 用法：bash deploy.sh    （在项目根目录运行）
# 产出：<PROJECT_NAME>.pages.dev 生产环境部署
set -eu
cd "$(dirname "$0")"

if command -v wrangler >/dev/null 2>&1; then
  WRANGLER=(wrangler)
else
  WRANGLER=(npx --yes wrangler@latest)
fi

if ! "${WRANGLER[@]}" whoami 2>&1 | grep -q "Account Name\|Account ID"; then
  echo "❌ wrangler 未登录。请先手动执行：npx wrangler login（交互式，需浏览器授权）"
  echo "   部署账号见 docs/HANDOVER.md §1.2（demoqqxu@gmail.com）"
  exit 1
fi

# 只从已提交的干净工作区部署（deploy.sh 拷的是工作区文件，不是某个提交）。
# 2026-09 曾有一版直接从没提交的工作区部署，线上与仓库分叉了 4 天，差点被一次正常部署整体覆盖、
# 把用户数据里的新字段抹掉（见 docs/HANDOVER.md「当前版本」）。确需临时部署：ALLOW_DIRTY=1 bash deploy.sh
COMMIT_ARGS=()
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if [ -n "$(git status --porcelain)" ] && [ "${ALLOW_DIRTY:-}" != "1" ]; then
    echo "❌ 工作区有未提交的改动，拒绝部署。先提交并推送，再部署："
    git status --short
    exit 1
  fi
  COMMIT_ARGS=(--commit-hash "$(git rev-parse HEAD)" --commit-message "$(git log -1 --format=%s)")
  echo "→ 部署提交 $(git rev-parse --short HEAD)：$(git log -1 --format=%s)"
fi

# 只部署应用运行时需要的文件和 Pages 响应头规则，不带上 .git/、docs/、test/、*.md
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp -r index.html manifest.json icon.svg sw.js _headers css js "$TMP"/

# 缓存穿透：部署时把 index.html 里所有 ?ver=N 替换成时间戳，
# 手机浏览器（尤其 iOS Safari 缓存激进）每次上线都能立刻拿到新 css/js，不用手动刷新
STAMP="$(date +%Y%m%d%H%M%S)"
sed -i "s/?ver=[0-9]*/?ver=${STAMP}/g" "$TMP/index.html"

"${WRANGLER[@]}" pages deploy "$TMP" \
  --project-name=stroke-rehab-assistant \
  --branch main \
  ${COMMIT_ARGS[@]+"${COMMIT_ARGS[@]}"} \
  --commit-dirty=true

echo "✅ 已部署。线上地址: https://stroke-rehab-assistant.pages.dev/"
