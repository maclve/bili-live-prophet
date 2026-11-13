# B站直播预言（竞猜）网页版

B 站直播间的「预言」（竞猜）玩法原本只能在手机 App 里参与，网页端没有入口。这个项目把它补到了网页端：主播开启预言后，可以直接在电脑上查看题目并下注。

提供两种形式，代码相同，任选其一（不要同时启用）：

- 浏览器扩展（Chrome / Edge，Manifest V3）
- 油猴脚本（Tampermonkey / Violentmonkey）

> 非官方项目，与哔哩哔哩无任何关联。接口随时可能被 B 站调整，届时功能可能失效。

## 功能

- 在直播间底部礼物栏左侧增加「预言」按钮，有进行中的预言时亮起粉色圆点
- 查看题目、门票（硬币）、截止倒计时、双方人数和猜对大约能得多少硬币
- 点选项参与预言，下注前会弹出确认框
- 查看硬币余额和最近 100 条预言历史
- 没有礼物栏的页面（部分活动皮肤直播间）改为显示右侧悬浮按钮

## 安装

### 油猴脚本

安装 Tampermonkey 或 Violentmonkey 后，打开 [`dist/bili-prophet.user.js`](dist/bili-prophet.user.js) 的 Raw 地址即可安装。

### 浏览器扩展（开发者模式）

1. 下载本仓库
2. 打开 `chrome://extensions`（Edge 为 `edge://extensions`），开启「开发者模式」
3. 点「加载已解压的扩展程序」，选择仓库根目录

## 使用

1. 在浏览器里登录 B 站账号
2. 打开任意直播间（`live.bilibili.com/房间号`）
3. 点击礼物栏左侧的「预言」按钮

## 注意事项

- 参与预言会消耗账号里的 B 站硬币作为门票，猜错不退
- 每个预言只能选一边，下注后不能更改；主播不能参与自己开启的预言（均为官方规则）
- 面板打开时每 4 秒刷新一次，收起时每 20 秒检查一次，标签页在后台时暂停

## 隐私

只在 `live.bilibili.com` 上运行，只请求 B 站自己的直播接口，使用浏览器里已有的登录状态。不收集、不上传任何数据，没有第三方服务器。

## 原理

手机 App 里的预言面板是一个内嵌网页（`live-app-guessing-game`），本项目调用与它相同的接口：

| 接口 | 用途 |
| --- | --- |
| `GET /xlive/app-ucenter/v1/elden/get_by_user` | 当前主播的预言列表和我的硬币 |
| `GET /xlive/app-ucenter/v1/elden/is_in_fans_group` | 下注前复查硬币余额 |
| `POST /xlive/app-ucenter/v1/elden/user_join` | 参与预言 |
| `GET /xlive/app-ucenter/v1/elden/hsitory_user` | 我的预言历史（官方接口拼写如此） |

## 开发

全部逻辑在 [`content.js`](content.js)，没有依赖。修改后运行：

```sh
sh build.sh
```

会根据 `manifest.json` 里的版本号生成：

- `dist/bili-prophet-<版本>.zip`：扩展商店上传包
- `dist/bili-prophet.user.js`：油猴脚本

## 许可证

MIT
