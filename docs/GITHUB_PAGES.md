# GitHub Pages 部署

本仓库已提供专用的静态构建和 `Deploy GitHub Pages` 工作流，使用与原网站相同的页面和交互。

## 首次启用（仓库管理员操作一次）

1. 打开 <https://github.com/Cx300-fh/NBA/settings/pages>。
2. 在 **Build and deployment → Source** 中选择 **GitHub Actions**。不需要再选模板或创建新工作流。
3. 打开 <https://github.com/Cx300-fh/NBA/actions/workflows/deploy-pages.yml>。
4. 选择 **Run workflow → main → Run workflow**。如果首次自动运行的构建已成功、部署因 Pages 未启用而失败，也可打开那次运行并选择 **Re-run failed jobs**。
5. 等待 `build`、`deploy` 都变成绿色，访问 <https://cx300-fh.github.io/NBA/>。以部署任务输出的实际链接为准。

代码提交触发构建和发布；NBA 定时快照更新任务成功后，也会触发 Pages 重新发布。不需要填写 API Key、部署密钥或安装额外服务。

## 数据与静态托管

GitHub Pages 只托管静态文件，不能运行原版的 `/api/nba` 服务。因此这个构建做了以下适配：

- 页面、海报、字体、静态数据都带 `/NBA/` 路径前缀；标签和比赛详情继续使用 hash 路由。
- NBA 官方球员、球队、排名与高阶数据读取构建生成的独立 JSON 快照，默认每 6 小时更新。
- 赛程、比分、单场技术统计优先从浏览器读取 NBA 官方 CDN；受 NBA 跨域／防护限制时回退到最新定时快照，并显示缓存状态和真实数据时间。
- BPM 仍取决于 Basketball Reference 是否允许请求；来源被拒绝时显示不可用，不填造数值。
- 个人评分和笔记仍保存在当前浏览器，支持导入／导出。原独立站点和 Pages 是不同域名，迁移笔记时先在旧站导出，再到新站导入。
- 竞猜中心在赛前只显示胜负选择；到达开赛时间即封盘。赛中可以逐球员写笔记，赛后默认打开球员复盘，展示得分构成、命中率、真实命中率、正负值和逐节比分。
- 近期 14 天内已经开始的比赛会收集单场统计，已缓存的完赛统计持续保留；网页按比赛读取文件，不把完整增长的单场档案装进首屏脚本。

如果需要不受浏览器跨域限制的实时数据，需要额外部署公开的数据代理；Pages 本身不能提供这项后端能力。现有定时统计和个人观赛功能不需要额外后端。

## 竞猜账号

访客点击右上角“登录 / 注册”，建立用户名和密码即可。无需 GitHub 账号或 Token。

Pages 继续负责静态网页；账号 API 与私有 D1 数据库部署在独立服务。配置与自行部署说明见 [ACCOUNTS.md](ACCOUNTS.md)。竞猜按账号隔离并跨设备保存，GitHub Actions 每 6 小时按月匿名归档；旧 `predictions/YYYY-MM.json` 文件保留。

## 球员与历史资料

新增 Players 页，排行榜姓名和对比卡也可进入完整档案。历史赛季同时出现在 Statistics 和 Contrast 的赛季选择器中。2025–26 数据已存在；2026–27 若尚无常规赛记录，页面会提供2025–26入口。

原始来源与覆盖范围见 [球员档案](../data/PLAYER_PROFILES.md)、[历史数据](../data/archive/README.md)。`prepare-explore.mjs` 在两种构建里生成静态资料，Pages 使用 `/NBA/explore/` 前缀，Worker 使用 `/explore/`。目录单独读取，详情和生涯按ID拆64份，历史资料按赛季读取。构建产物不需要提交。

`Refresh player library` 每天更新目录／详细档案，`Refresh official NBA data` 每6小时更新近期数据与当前赛季区域投篮；两个定时任务成功后都会触发 Pages 发布。已成功收集的历史资料默认保留，减少重复抓取。

经典回放需访问第三方YouTube播放器，仅点击播放后加载；源站限制时可打开NBA或YouTube原页。

## 本地构建

```bash
pnpm install --frozen-lockfile
pnpm build:pages
pnpm test:pages
```

构建输出为 `dist-pages/`，数据文件在构建时生成，不需要提交该目录。

如部署到其他仓库或根域名，可在工作流中调整 `PAGES_BASE_PATH`：当前仓库为 `/NBA/`，根域名为 `/`。

## 常见问题

- **Configure Pages 失败，提示 Not Found / Pages 未启用**：完成上面的 Source 设置，然后重新运行失败的部署任务。
- **显示旧数据**：确认 `Refresh official NBA data` 与之后的 `Deploy GitHub Pages` 都成功；页面保留的数据时间可用于判断是否更新。
- **图片或字体 404**：确认构建使用 `PAGES_BASE_PATH=/NBA/`。
- **部署任务等待审批**：查看仓库 `Settings → Environments → github-pages` 是否设置了人工审批，按仓库规则批准部署。
