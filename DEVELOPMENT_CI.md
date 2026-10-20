# 开发集成与检查

适用仓库：`wantai-dev/001-arcteryx-deals-platform`。命令来源基线：`5af24c86ce9eb365b24ba22a7cbb3da679ae9ab7`。

开发成果先汇总到统一 `dev`，不为小改动建立 PR；集成 PR 仅走 `dev → main`。日常本地只运行本次变更与实际受影响模块的检查，按需进一步缩到定向测试文件，不默认跑全部清单。

普通远端 CI 仅由 `.github/workflows/integration-ci.yml` 手动触发：输入一个当前打开的 `dev → main` PR，并核对当前 `dev` SHA；push、开 PR 和更新 PR 均不自动运行普通 CI。清单只执行隔离验证，不包含生产部署或真实业务写入。

本地命令（在仓库根目录；`--base` 使用实际开发基线）：

```sh
python3 tools/development_ci.py changed --base origin/dev --dry-run
python3 tools/development_ci.py changed --base origin/dev
python3 tools/development_ci.py full --dry-run
# 首次隔离 checkout 或依赖变化时，明确安装清单依赖：
python3 tools/development_ci.py full --install
```

完整回归由本机统一调度器在每天 05:00（Asia/Taipei）串行执行 `python3 tools/development_ci.py full`（首次或依赖变化加 `--install`），使用登记的仓库、基线与执行目录。本文和 manifest 不创建系统定时任务，也不证明本机调度已经安装或产品回归已经执行。

清单的 `paths` 是模块影响范围；共享类型、依赖和配置变化会扩大相关检查。跨模块调用关系另有影响时补跑调用方的定向测试。`full` 运行下列全部检查，覆盖范围以本文件列出的局限为准。

| 检查 | 命令 | 工作目录 |
| --- | --- | --- |
| `python-unit` | `python3 -m unittest discover -s tests -v` | `.` |
| `web-node-unit` | `node --test tests/test_artifact_revision.js tests/test_catalog_api.js tests/test_geo_product_endpoint.js tests/test_product_names.js tests/test_product_server.js tests/test_seo_index_policy.js tests/test_web_product_preview.js` | `.` |
| `app-tests` | `npm test` | `app` |
| `app-typecheck` | `npm run typecheck` | `app` |
| `app-verify-config` | `npm run verify:config` | `app` |
| `app-verify-release-assets` | `npm run verify:release-assets` | `app` |
| `app-verify-store-metadata` | `npm run verify:store-metadata` | `app` |

命令来源：`requirements.txt`、原 `.github/workflows/refresh-outlet.yml`、现有 `tests/test_*.py/js`、`app/package.json` 与 `app/scripts/verify-local.ts`。

运行条件与覆盖边界：

- Node.js22与Python3.13；根Python tests为原refresh-outlet生命周期验证所用unittest discover，JS测试显式列出当前全部tests/test_*.js。app使用现有npm scripts。
- app verify:local含live汇率、线上数据探针、Expo doctor下载与iOS导出清理，因此没有直接作为完整回归命令；只选它已有的隔离unit/typecheck/config/assets/store-metadata步骤。full不包括App Store、iOS构建/提交、截图视觉验收或真实汇率与生产数据新鲜度。
- 10份现有业务workflow（采集、刷新、价格审计、GEO/新鲜度监控与诊断）字节保持；不更改schedule，不以它们充作回归。manifest不启动采集、Supabase同步、通知、IndexNow、在线修复或任何真实写入。
- 当前清单仅在无生产凭证的隔离checkout执行；完整测试的网络mock/本地HTTP夹具不证明真实源站和生产可用性。

现存业务监控、数据采集与生产发布遵守原有授权及专项验收；不把业务 schedule 充作夜间产品回归。远端 required checks 或规则集需要与新手动 CI 的检查名核对后迁移。
