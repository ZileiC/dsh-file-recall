# 统计口径

这里只放 GitHub 自己给出的数字，不做推断。

## 当前（2026-11-19）

| 指标 | 数值 | 能说明什么 |
|---|---|---|
| Release 附件下载 | **1** | 唯一直接对应「有人拿走了安装包」的数字 |
| 页面浏览（14 天） | 6 次 / 1 位访客 | 有人打开过仓库首页 |
| Clone（14 天） | 177 次 / 97 个来源 | **不等于 97 个人**，见下 |

## 为什么 clone 数不能当下载量

- GitHub 的 clone 统计**只计未认证的拉取**。实测：用仓库主的账号认证地下载一次 zipball（HTTP 200，6,046,479 字节）之后再查，clone 数字没有变化。
- 所以这 97 个来源绝大多数没有 GitHub 账号：爬虫、镜像站、搜索引擎、自动构建。
- 结论：**目前「通过 GitHub 拿到安装包」的可核验证据只有 1 次 release 下载。**

## 为什么没有页面级统计

安装大多由用户自己的 agent 完成（`plugin_manager install_bundle`），这条路**不经过我们的任何服务器**，看不见。打开网页指南的人是少数，所以页面统计天然偏低。

GoatCounter 之类的第三方统计能让页面可视，代价是给页面引入外部脚本与请求：`install-universal.html` 现在能做到「单文件、零外部请求」，加它就等于放弃这个性质。**当前决定不加。**

## 14 天窗口

GitHub 的 views / clones 只保留 14 天，过期永久消失。`scripts/traffic.mjs` 每次把当天数字并进 `traffic.jsonl` 与 `traffic.csv`，同一天跑多少次都不会重复写。

```text
node scripts/traffic.mjs
```

Release 下载数是累计值，不会过期。

## 为什么没有自动化

**GitHub Actions 的 `GITHUB_TOKEN` 读不到 traffic**。实测把工作流跑了一遍，`GET /repos/.../traffic/views` 返回：

```text
403 Resource not accessible by integration
```

traffic 接口只对仓库管理员权限开放，而 Actions 的默认令牌拿不到这一级。所以想自动记录，只能：

- 有人**每天手动跑一次** `node scripts/traffic.mjs`；或
- 配一个个人访问令牌放进仓库 secret（有泄露风险，**当前不做**）。

因此这张表靠手动更新。宁可记不全，也不放一个跑不通的定时任务在那儿假装在记。
