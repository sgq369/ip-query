# ip-query — 钦律亲为 IP 查询站

Cloudflare Worker + 静态前端，线上地址：https://ip.sungongqin.com/

代码仓库：https://github.com/sgq369/ip-query （公开）

## 目录

- `src/index.js` — Worker：`/api/*` 查询接口、Top IP 落地页服务端渲染、404 页、缓存头
- `public/index.html` — 前端单文件（查询、IP 计算器、RDAP、多源 DNS 对照、泄露/出口检测、纯净度评分、中英双语）
- `public/robots.txt`、`public/sitemap.xml` — SEO（sitemap 由 `TOP_IPS` 生成，改白名单后需重生成）
- `public/manifest.json`、`public/icon-*.png`、`public/og.png` — PWA 与分享图
- `wrangler.toml` — Worker 配置（`run_worker_first = true` 必须保留，否则静态资源不走 Worker，缓存头改不上去）
- `deploy.py` — 部署脚本

## 部署（只能在沁言这台 VM 上跑）

```bash
cd ip-query
PYTHONPATH=/opt/muse/skills/custom-connector-setup/bin python3 deploy.py
```

部署用保险库 `custom.cloudflare` 的 surrogate token，内存传给 wrangler，不落盘。
WorkBuddy 改完代码可以提 PR，**部署仍走这边**，不要在 Mac 上配 Cloudflare 凭证。

## 关键口径（别踩）

- 纯净度评分是本站自定透明规则（基础 100 分扣分制），必须明示“非官方评分”，不仿官方分。
- 落地页只做 `TOP_IPS` 里的 61 个高频 IP（`src/index.js`），其余 `/ip/` 走 SPA + `X-Robots-Tag: noindex`，不批量生成。
- 免费 API 区块已按要求撤掉，不再对外宣传（接口本身仍供页面内部调用）。
- `/api/me` 经纬度必须是数字，`lookup` 返回的也是数字，两边 schema 要一致。
- 单文件 inline JS 里别用 `t` 这类单字母函数名——主题代码的 `var t` 曾覆盖 i18n 的 `t()`，整页 JS 启动即死。
- 统计是 Cloudflare Web Analytics（beacon 已埋首页），token 在 `index.html` 里，是公开的 beacon token。

## 同步方向

线上以本机 `~/workspace/build/website/ip-query/` 为准；改完这边部署后，同步一份到 GitHub 仓库；Gitea 主站仓库 `qinlv/sungongqin-website` 里的 `workers/ip-query/` 只是一份备份镜像。
