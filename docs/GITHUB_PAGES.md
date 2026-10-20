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

## 竞猜连接 GitHub

竞猜保存使用 GitHub Contents API。你对 ChatGPT GitHub 插件的授权不会自动传给公开的 Pages 网站，所以需要在网站内连接一次：

1. 打开网站 **Picks → 连接 GitHub**。
2. 使用仓库所有者 `Cx300-fh` 账号创建 [Fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)，设置一个合适的有效期。
3. **Repository access → Only select repositories** 仅选择 `NBA`。
4. **Repository permissions → Contents** 设为 **Read and write**，不需要 Workflows 权限。
5. 把令牌填进网站的密码框并连接。不要把令牌写到代码或发到聊天里。

令牌只存在当前页面内存，刷新页面、关闭页面或点击断开连接后需要重新连接。网站直接读写 `main` 上的 `predictions/YYYY-MM.json`，每月一个文件；一个月内的多场竞猜会合并写入。同一场比赛赛前可以修改，开赛后锁定。保存前重新读取最新文件和赛程，利用文件 SHA 检查冲突，冲突时重新合并，失败时明确提示，避免覆盖其他比赛记录。仅有 Contents 读取权限时可以查看记录，但提交保存会报权限不足。

当前仓库公开，所以竞猜记录也公开；私人观赛笔记继续保存在本机。这个连接写入的是仓库所有者的一份共享个人竞猜档案，不是多用户账号系统。赛前锁定用于个人记录，不提供防篡改赛事认证。

定时数据任务每 6 小时用 NBA 完赛比分补充竞猜结果，网站也可直接依据当前已完赛比分显示猜中／未中与月度命中率。没有结果的比赛保持待结算。竞猜提交只更新文件，不触发完整 Pages 重建。

NBA 单场统计没有提供可靠出手坐标时，赛后展示有数据依据的得分构成和投射效率，不生成虚构的热点图。

接口权限依据：[GitHub Contents API](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents)、[Fine-grained tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)。

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
