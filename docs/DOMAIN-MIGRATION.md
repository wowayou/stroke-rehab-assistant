# 迁移到 eigentime.org 子域名

当前站点与部署入口见 [HANDOVER.md](HANDOVER.md)。`xxx.eigentime.org` 是占位符，执行时先确定最终子域名与其 DNS（Domain Name System，域名解析系统）管理账号。

## 数据边界

浏览器按「协议 + 主机名 + 端口」隔离本地存储。`pages.dev`、新子域名、HTTP、HTTPS 和本地双击打开的数据彼此独立。绑定域名不会搬数据，重新添加主屏幕图标也不会搬数据。

保留旧站可用，不提前自动重定向或禁用 `pages.dev`。否则患者可能无法回旧地址导出记录。迁移采用现有本地备份文件，不上传健康数据，也不放宽页面联网限制。

## 执行顺序

1. 在旧地址「设置 → 备份全部数据」下载完整备份。确认文件存在且能被恢复预览识别；给医生看的文本报告不能替代备份。
2. 在现有 Cloudflare Pages 项目 **Custom domains → Set up a domain** 添加最终域名。按面板配置 CNAME（Canonical Name，别名记录），目标为项目的 `stroke-rehab-assistant.pages.dev`。先关联 Pages 项目，再确认 DNS；仅创建 CNAME 可能得到 522 错误。不要改动 `eigentime.org` 的其他应用记录。
3. 等待域名激活及 HTTPS 证书生效。验证五个 `?view=` 页面、相对静态资源、响应头和备份功能。确认没有注入分析脚本；仍只部署 `deploy.sh` 指定的运行文件。
4. 在新地址从旧站备份恢复；核对称呼、药物及疗程、血压/血糖/体重、训练记录。刷新新站再次核对；验证新站下载的备份能解析。测试恢复撤销时使用隔离测试数据，避免影响患者记录。
5. 新站确认可用后再更新收藏或主屏幕入口；日常只在一个地址继续记录。旧地址暂保留给尚未迁移的设备，不设强制跳转。每台使用设备均需独立确认。

## 失败与回退

新域名打不开时继续用旧站。新站已有新增记录时先备份新站，再决定是否导回旧站；恢复是整体替换，不会自动合并两边记录。原备份和旧浏览器数据保留到人工核对完成。旧站关闭的时间须单独决定。

## 依据

- [Cloudflare Pages — Custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)（2026-09-25 核对）。
- [MDN — localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)：存储按 origin 隔离，`file:` 行为依浏览器而异。

域名激活状态、DNS 账号、证书与真实用户迁移结果只记录在 HANDOVER，本文保留执行方法。
