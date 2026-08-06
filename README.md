# post-helper

把 Obsidian 笔记草稿转成「手机扫码 → 点击即复制」的发布页。

以后发小红书笔记，不用一段段在手机和电脑之间切来切去。

---

## 当前状态

- 已实现：本地生成 + 本地预览 + **自动部署到他妈的线上**
- 已部署：`https://post-helper.hisamjo.live/` （team: sam-jos-projects）

---

## 访问入口

| URL | 含义 |
|---|---|
| `https://post-helper.hisamjo.live/` | **最新已发草稿**（自动同步 mtime 最新那篇） |
| `https://post-helper.hisamjo.live/<publish_id>/` | 指定 publish_id 的发布页 |
| `https://post-helper.hisamjo.live/qrcode.min.js` | 二维码库（页面里用了） |

**手机扫码**：打开任一发布页，**页面顶端就有二维码**（指向当前页 URL），可以直接微信/小红书扫码 → 进入。无需记 URL。

---

## 明天接上的两件事

部署前要确认（已答）：

## 哪些笔记用这个工具 / 哪些不用

| 笔记类型 | 用？ | 原因 |
|---|---|---|
| `05.我的产品/商品笔记/草稿箱/` 里的笔记 | ✅ | 这是真正要发小红书的草稿 |
| `05.我的产品/商品笔记/已发布/` 里的归档 | ❌ | 已发，无须发布页 |
| `01-04` 的输入/方法论/弹药库/复盘 | ❌ | 沉淀给自己的，不上小红书 |
| 临时日常笔记 | ❌ | 不是发布草稿 |

**判断标准**：问自己——「我未来一周内会把这篇发到小红书吗？」是 → 填 `publish_id` 用本工具；否 → 不用管。

> 历史：ship 命令在 `2026-08-07` 修过 git add bug（用 `git add -A` 一次到位，避免 Git Bash 多参数拆错）。

---

## 发布完整流程

```bash
# 1. 在笔记里加 publish_id + 5 个标记块（参见下方"笔记格式约定"节）

# 2. 一行命令搞定一切
cd /d/zhouxiping/post-helper
OBSIDIAN_VAULT="D:/zhouxiping/21_Breakout/AI虚拟产品全链路作战系统/xlquiz" \
  node publish.mjs ship "D:/zhouxiping/21_Breakout/AI虚拟产品全链路作战系统/xlquiz/05.我的产品/商品笔记/<想发的那篇>.md"

# 3. 等 10-30 秒，Vercel 自动部署，访问：https://post-helper.hisamjo.live/<publish_id>/
#    手机扫码页面顶端的二维码即可
```

`ship` 子命令做的事：
1. 读笔记 → 提取标记块 → 渲染 `dist/<publish_id>/index.html`
2. 扫 vault 找 mtime 最新 → 覆盖 `dist/index.html`（根路径）
3. 拷 `template/qrcode.min.js` 到 `dist/`（二维码库）
4. `git add + commit + push` → Vercel 自动部署

> ⚠ Windows + Git Bash 下 `git add 多参数 + 中文路径` 会拆错，ship 命令目前会**先尝试正常 add，失败时显示错误码**，需要时手工：
> ```bash
> cd /d/zhouxiping/post-helper
> git add dist  # 单次 add 整个 dist
> git add .
> git commit -m "ship: <id>"
> git push origin main
> ```

## 目录

```
post-helper/
├── package.json
├── publish.mjs              # 核心脚本（Node.js）
├── template/
│   └── index.html           # 复制页模板
├── dist/                    # 生成的静态页（不进 git）
│   └── <publish_id>/
│       └── index.html
└── README.md
```

---

## 笔记格式约定

**只在 05.我的产品/商品笔记/ 下的草稿箱使用此约定**。复盘、方法论、输入等沉淀类笔记不需要。

### 前置 frontmatter

```markdown
---
publish_id: xiang-tai-duo    # 用作 URL: post-helper.hisamjo.live/<publish_id>/
                            # 必填，没有就跳过生成发布页
---
```

**`publish_id` 是硬规则**——只有真正准备发小红书的草稿才填这个字段。脚本会主动拦截没填的笔记，避免幽灵发布页。命名建议：`kebab-case` 英文短语，不用中文（URL 友好），例如 `ningjingli-cexin`、`qingxu-jiancha-5tian`。

### 标记块

在正文任意位置（推荐紧跟 frontmatter）加 HTML 注释标记块。`POST_TITLE` 和 `POST_BODY` 必填，其它可选：

```html
<!-- POST_TITLE_START -->           ← 必填
发布标题一句话
<!-- POST_TITLE_END -->

<!-- POST_BODY_START -->             ← 必填
小红书正文，多行可。
<!-- POST_BODY_END -->

<!-- POST_PIN_START -->              ← 可选：置顶评论
这通常是引导互动的一句
<!-- POST_PIN_END -->

<!-- POST_REPLIES_START -->          ← 可选：评论回复库
<!-- @reply A+B 你的回复文本 -->
<!-- @reply A+C 你的回复文本 -->
<!-- @reply B+D 你的回复文本 -->
<!-- POST_REPLIES_END -->

<!-- POST_CARDS_START -->            ← 可选：大字报分页文字稿
【第1页｜封面】
正文
=== 第2页｜标题 ===
正文
<!-- POST_CARDS_END -->
```

### 标记块在 Obsidian 里的渲染

在 Obsidian / Typora 里 HTML 注释块完全隐身（折叠成空白），不影响笔记阅读，脚本能精确定位。

---

## 本地使用

### 1. 生成预览页

```bash
node publish.mjs publish "笔记路径.md"
```

示例：

```bash
node publish.mjs publish "D:/.../二创-想太多的人-4种思考天赋自测.md"
```

输出：

```
✓ 已生成：D:\zhouxiping\post-helper\dist\xiang-tai-duo\index.html
```

### 2. 启动本地预览

```bash
node publish.mjs preview
```

访问：

- `http://localhost:4173/xiang-tai-duo/`  ← 这篇笔记的预览
- 同一个 WiFi 下，手机访问 `http://你的电脑IP:4173/xiang-tai-duo/` 可以真机测试一键复制

---

## 明天部署清单

> 按你的项目规则：部署一切写操作（建仓、绑域名、加 DNS）执行前都必须用户确认。

### Step 1 · 建仓

仓名约定：`SamJo2023/post-helper`（公开）

```bash
cd D:\zhouxiping\post-helper
git init
gh repo create SamJo2023/post-helper --public --source=. --push
```

### Step 2 · Vercel 建项目

```bash
curl -sX POST https://api.vercel.com/v10/projects \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -d '{"name":"post-helper-hisamjo","gitRepository":{"type":"github","repo":"SamJo2023/post-helper"}}'
```

### Step 3 · Vercel 绑域名

```bash
curl -sX POST https://api.vercel.com/v10/projects/post-helper-hisamjo/domains \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -d '{"name":"post-helper.hisamjo.live"}'
```

### Step 4 · Cloudflare 加 DNS

CNAME `post-helper` → `cname.vercel-dns.com`，**代理必须开**（SSL 模式 Full）。

```bash
curl -sX POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"CNAME","name":"post-helper","content":"cname.vercel-dns.com","proxied":true}'
```

### Step 5 · Vercel 部署配置

仓库根目录建议加一个 `vercel.json`，让根路径直接 redirect 到默认笔记（或者建一个 index 列表）：

```json
{
  "cleanUrls": true,
  "trailingSlash": true
}
```

部署后访问：

- `https://post-helper.hisamjo.live/`  ← 部署占位页（待定）
- `https://post-helper.hisamjo.live/xiang-tai-duo/`  ← 这篇笔记

---

## 明天需要 Sam 回答的两个问题

部署开工前，要确认：

1. **根路径（`post-helper.hisamjo.live/`）放什么？**
   - 方案 A：自动生成所有笔记列表（要写一个 list 入口）
   - 方案 B：扫码进草稿箱里的固定二维码
   - 方案 C：先空着，标"建设中"

2. **issue 一键同步**：要不要把"写完后 `node publish.mjs publish + git push`"做成一个命令（`node publish.mjs ship`），推到主分支自动部署？

---

## 之后可以扩展的功能（未实现，留着）

- [ ] `ship` 命令：publish + git add + commit + push 一条龙
- [ ] 多笔记列表入口（根路径）
- [ ] 二维码生成（手机扫码友好）
- [ ] Obsidian Templater / QuickAdd 插件打通（写完笔记按钮触发）
- [ ] 简易分析：访问次数 / 复制次数统计
