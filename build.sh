#!/bin/sh
# 由 manifest.json + content.js 生成两种发布物：
#   dist/bili-prophet-<版本>.zip   浏览器扩展商店上传包
#   dist/bili-prophet.user.js      油猴脚本（Tampermonkey / Violentmonkey）
set -e
cd "$(dirname "$0")"
VER=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
mkdir -p dist

rm -f "dist/bili-prophet-$VER.zip"
zip -q -X -r "dist/bili-prophet-$VER.zip" manifest.json content.js icons -x '*.DS_Store'

{
  cat <<EOF
// ==UserScript==
// @name         B站直播预言（竞猜）网页版
// @namespace    bili-live-prophet-web
// @version      $VER
// @description  让 B 站直播间的「预言」竞猜玩法在网页端也能查看和参与（原本仅手机 App 可用）。非官方脚本，与哔哩哔哩无关联。
// @match        https://live.bilibili.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// @license      MIT
// ==/UserScript==

EOF
  cat content.js
} > dist/bili-prophet.user.js

echo "built: dist/bili-prophet-$VER.zip, dist/bili-prophet.user.js"
