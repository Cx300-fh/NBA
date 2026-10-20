# COURTSIDE.

一个为认真看球的人设计的 NBA 观赛网站。全屏球员海报，标签切换页面，NBA 官方统计，以及你自己的球员观察手记。

**GitHub Pages：** <https://cx300-fh.github.io/NBA/>（首次启用需在仓库 Settings → Pages 将 Source 设为 GitHub Actions）。完整步骤见 [GitHub Pages 部署指南](docs/GITHUB_PAGES.md)。

原服务端构建使用 `pnpm build`；Pages 静态构建使用 `pnpm build:pages`。

- **Home**：三张真实比赛照片构成的球员主题海报。
- **Game Center**：北京时间比赛日、日期与球队筛选、实时比分、逐场技术统计、已观看标记。
- **球员观察**：防守选择、得分手段、三分稳定性、组织决策、无球参与、比赛投入六项评分；观察重点、自由笔记、节次与剩余时间标记。未评分保持为空，个人评价不冒充官方数据。
- **Statistics**：东西部排名，球员与球队的基础数据，TS%、eFG%、使用率、进攻／防守／净效率、PACE、PIE；排序、分区、最低场次与搜索筛选、分页。
- **Contrast**：搜索并比较两名球员或两支球队，基础数据／投射效率／高阶表现分组、数据条与联盟百分位雷达图。比较采用同赛季常规赛场均口径。
- **我的观赛手记**：在当前浏览器保存，自动保存、搜索、JSON 导出／导入与跨设备手动迁移。导入合并时保留较新的记录。没有接入服务器账号同步。

## 运行

需要 Node.js 22.13+、pnpm 11.25。Python 3.10+ 用于更新数据快照。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

```bash
pnpm exec tsc --noEmit
pnpm test
python tests/data.test.py
pnpm build
```

采用 React 19 + TypeScript + Vinext + Cloudflare Worker；生产构建同时包含网站与 `/api/nba` 服务。保留 `vite.config.ts` 中的 `sites()` 集成。`.openai/hosting.json` 关联已部署的 Site；复制为新的独立 Site 时应通过 Sites 注册新项目。

## 数据与更新

`/api/nba?resource=players&season=2025-26` 是有白名单的同源数据服务。支持 `players`、`teams`、`standings`、`bpm`、`roster`、`schedule`、`scoreboard`，以及 `boxscore&id=0012600008`。不需要付费 API Key，客户端不会向任意网址转发请求。

| 数据 | 来源 | 刷新方式 |
| --- | --- | --- |
| 比分、单场技术统计 | NBA 官方 liveData CDN | 页面每 30 秒轮询，服务端缓存 30 秒 |
| 赛程 | NBA 官方 scheduleLeagueV2 CDN | 每小时缓存刷新 |
| 常规赛球员、球队与分区排名 | stats.nba.com | 每 6 小时缓存刷新 |
| BPM、OBPM、DBPM、VORP、PER、WS | Basketball Reference | 每 6 小时尝试；失败时明确显示不可用 |
| 备用快照 | 本仓库 `data/snapshot.json` | GitHub Actions 每 6 小时更新 |

网站仅在数据确实成功读取后更新数据时间。网络失败会保留有效数据，并显示“缓存数据”。NBA 上游可能短暂返回超时或拒绝请求。比赛在北京时间跨日，日期选择、笔记日期与比赛卡片统一采用 `Asia/Shanghai`，而不是直接显示 NBA 的美国比赛日。

首次快照于 2026-10-20 从公开接口读取，包含 2024–25、2025–26 与 2026–27 三个常规赛季、当前赛季赛程和近期已完赛技术统计。新赛季未开赛时球员常规赛数据为空，这是正常状态。最低出场场次是自定义筛选，不代表 NBA 官方各项排行榜的资格标准。比赛卡片上的赛前名单并非最终出场确认。

**BPM 来源限制**：部署时 Basketball Reference 返回 HTTP 403，尚无有效 BPM 快照。网站保留独立的自动读取适配器与原站入口，不使用比赛正负值、NBA PIE 或推算值代替 BPM。NBA 官方其他高阶指标可正常读取。

手动更新备用快照：

```bash
python scripts/update-data.py
# 或指定赛季
python scripts/update-data.py --seasons 2024-25 2025-26 2026-27
```

GitHub Actions 的计划任务定义在 `.github/workflows/refresh-nba-data.yml`；GitHub 可能延迟计划运行。若仓库设置禁用 Actions，需先在仓库 Actions 中启用。更新任务保留上一次成功数据，完全没有有效球员数据时失败退出。

## 记录与隐私

观赛记录存储在当前网站域名下的 `localStorage`，键为 `courtside.notebook.v1`。每份评分按“比赛 ID + 球员 ID”隔离。浏览器清理数据、无痕窗口关闭或换设备不会自动迁移；通过“我的观赛手记 → 导出／导入”备份。存储不可用时页面显示失败提示，不声称已成功保存。

## 视觉素材

比赛照片与球员头像／球队标志来自 NBA 官方 CDN，版权归 NBA、球队及相应摄影权利人所有。本项目是独立观赛辅助工具，与 NBA 官方没有隶属关系。素材来源见 `data/assets.json`。字体使用 Anton、Barlow Condensed、DM Sans 与 IBM Plex Mono，均采用 SIL Open Font License，许可附于 `public/fonts/`。

## 验证

已通过 TypeScript、观赛记录导入导出与时区边界测试、NBA 快照一致性测试及生产构建。当前开发环境未提供受支持的浏览器自动化，未宣称完成真实浏览器端到端验收。
