#!/usr/bin/env bash
# 一键部署到 Cloudflare Pages（零构建，直传静态文件）
# 依赖：全局安装的 wrangler（npm install -g wrangler，需已 wrangler login）
# 用法：bash deploy.sh    （在项目根目录运行）
# 产出：<PROJECT_NAME>.pages.dev 生产环境部署
set -eu
cd "$(dirname "$0")"

# 只部署应用运行时需要的文件，不带上 .git/、docs/、test/、*.md
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp -r index.html manifest.json icon.svg css js "$TMP"/

wrangler pages deploy "$TMP" \
  --project-name=stroke-rehab-assistant \
  --branch main \
  --commit-dirty=true

echo "✅ 已部署。线上地址: https://stroke-rehab-assistant.pages.dev/"
