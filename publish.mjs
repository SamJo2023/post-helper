#!/usr/bin/env node
// post-helper - 把笔记草稿转成「点击即复制」的发布页
// 用法：node publish.mjs <command> [args]
//   publish <笔记路径>     本地模式：只生成 dist/，不推送
//   preview               本地起一个 http server，扫码预览
//   help                  用法

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(__dirname, 'template', 'index.html');
const DIST_DIR = resolve(__dirname, 'dist');

// ====== 标记块配置 ======
const MARKERS = [
  { key: 'TITLE',   name: 'POST_TITLE',   required: true  },
  { key: 'BODY',    name: 'POST_BODY',    required: true  },
  { key: 'PIN',     name: 'POST_PIN',     required: false },
  { key: 'REPLIES', name: 'POST_REPLIES', required: false },
  { key: 'CARDS',   name: 'POST_CARDS',   required: false },
];

// ====== URL 配置 ======
const BASE_URL = process.env.POST_HELPER_BASE_URL || 'https://post-helper.hisamjo.live';
const QRCODE_LIB_SRC = resolve(__dirname, 'template', 'qrcode.min.js');

// 回复库每一行的格式：<!-- @reply <标签> <文本> -->
const REPLY_LINE_RE = /<!--\s*@reply\s+([A-Za-z0-9+\-]+)\s+([\s\S]*?)\s*-->/g;

// ====== 工具函数 ======
function die(msg) { console.error(`\n× ${msg}\n`); process.exit(1); }
function info(msg) { console.log(`✓ ${msg}`); }
function pad2(n) { return String(n).padStart(2, '0'); }
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}

// 从笔记 frontmatter 提取 publish_id
function getPublishId(content) {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) return null;
  const fm = fmMatch[1];
  const idMatch = fm.match(/^publish_id:\s*(.+)$/m);
  if (idMatch) return idMatch[1].trim();
  // fallback: 用文件名
  return null;
}

function getTitleFromH1(content) {
  const m = content.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : '未命名笔记';
}

// 提取一个标记块，返回 { text, found }
function extractBlock(content, markerName) {
  const startRe = new RegExp(`<!--\\s*${markerName}_START\\s*-->`);
  const endRe   = new RegExp(`<!--\\s*${markerName}_END\\s*-->`);
  const startM = content.match(startRe);
  if (!startM) return { text: '', found: false };
  const startIdx = startM.index + startM[0].length;
  const tail = content.slice(startIdx);
  const endM = tail.match(endRe);
  if (!endM) return { text: '', found: false };
  return { text: tail.slice(0, endM.index).trim(), found: true };
}

function extractAll(content) {
  const result = {};
  for (const m of MARKERS) {
    const block = extractBlock(content, m.name);
    if (m.required && !block.found) {
      die(`笔记里找不到必填标记块：<!-- ${m.name}_START --> ... <!-- ${m.name}_END -->`);
    }
    result[m.key] = block;
  }
  return result;
}

function parseReplies(replyText) {
  if (!replyText) return [];
  const replies = [];
  let m;
  REPLY_LINE_RE.lastIndex = 0;
  while ((m = REPLY_LINE_RE.exec(replyText)) !== null) {
    replies.push({ tag: m[1].trim(), text: m[2].trim() });
  }
  return replies;
}

// JSON 安全编码（避免 </script> 等字符串破坏 HTML）
function safeJSON(s) {
  return JSON.stringify(s).replace(/</g, '\\u003c');
}

// 渲染回复列表的 HTML
function renderRepliesHTML(replies) {
  if (!replies.length) {
    return '<p style="color:#7a685a;font-size:13px;margin:0;">未配置回复库</p>';
  }
  return replies.map(r => {
    const safeText = r.text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const preview = r.text.length > 50 ? r.text.slice(0, 50) + '…' : r.text;
    const previewSafe = preview.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `
      <div class="reply-row">
        <span class="reply-tag">${r.tag}</span>
        <span class="reply-text">${previewSafe}</span>
        <button class="mini-btn" data-reply="${safeText}">复制</button>
      </div>`;
  }).join('\n');
}

// 计算大字报分页数（按 === 第N页 === 这种标记切）
function countCardsPages(text) {
  if (!text) return 0;
  const m = text.match(/===\s*第(\d+)页/g);
  if (!m) return 0;
  // 第一个分页之前的封面也算 1 页
  return m.length + 1;
}

// 渲染整页
function render(template, ctx) {
  let html = template;
  const cardsText = ctx.blocks.CARDS.text || '';
  const subs = [
    ['{{TITLE}}', ctx.title],
    ['{{SUBTITLE}}', ctx.subtitle],
    ['{{TITLE_TEXT}}', ctx.blocks.TITLE.text || '（未填写）'],
    ['{{BODY_TEXT}}', ctx.blocks.BODY.text || '（未填写）'],
    ['{{PIN_TEXT}}', ctx.blocks.PIN.text || '（未填写）'],
    ['{{BODY_LENGTH}}', String(ctx.blocks.BODY.text.length)],
    ['{{REPLIES_COUNT}}', String(ctx.replies.length)],
    ['{{REPLIES_HTML}}', renderRepliesHTML(ctx.replies)],
    ['{{TITLE_JSON}}', safeJSON(ctx.blocks.TITLE.text)],
    ['{{BODY_JSON}}', safeJSON(ctx.blocks.BODY.text)],
    ['{{PIN_JSON}}', safeJSON(ctx.blocks.PIN.text || '')],
    ['{{CARDS_TEXT}}', cardsText || '（未配置）'],
    ['{{CARDS_COUNT}}', String(countCardsPages(cardsText))],
    ['{{CARDS_JSON}}', safeJSON(cardsText)],
    ['{{PAGE_URL}}', ctx.pageUrl],
    ['{{DATE}}', today()],
  ];
  for (const [k, v] of subs) {
    html = html.split(k).join(v);
  }
  return html;
}

// ====== 主命令 ======
function cmdHelp() {
  console.log(`
post-helper - 把笔记草稿转成「点击即复制」的发布页

用法:
  node publish.mjs publish <笔记路径>   本地生成 dist/<id>/index.html
  node publish.mjs preview              启动本地预览（http://localhost:4173）
  node publish.mjs help                 显示帮助

笔记标记块（必须是 HTML 注释，包裹内容）:
  <!-- POST_TITLE_START -->...<!-- POST_TITLE_END -->
  <!-- POST_BODY_START -->...<!-- POST_BODY_END -->
  <!-- POST_PIN_START -->...<!-- POST_PIN_END -->
  <!-- POST_REPLIES_START -->
  <!-- @reply A+B 你的回复文本 -->...
  <!-- POST_REPLIES_END -->

前置 frontmatter 字段:
  publish_id: xiang-tai-duo   # 用作 URL 路径
`);
}

// ====== 渲染核心：抽出来复用 ======
function renderNotePage(content) {
  const blocks = extractAll(content);
  const id = getPublishId(content);
  if (!id) {
    die([
      `这篇笔记 frontmatter 没有 publish_id，按设计跳过`,
      ``,
      `  如果这篇是要发的草稿，在 frontmatter 加一行：`,
      `    publish_id: xiang-tai-duo    # 用作 URL: post-helper.hisamjo.live/<publish_id>/`,
    ].join('\n'));
  }
  const title = getTitleFromH1(content);
  const replies = parseReplies(blocks.REPLIES.text);

  info(`使用 publish_id：${id}`);
  info(`标题：${title}`);
  info(`正文：${blocks.BODY.text.length} 字`);
  info(`置顶：${blocks.PIN.found ? blocks.PIN.text.length + ' 字' : '未配置'}`);
  info(`回复库：${replies.length} 条`);
  info(`大字报：${blocks.CARDS.found ? countCardsPages(blocks.CARDS.text) + ' 页' : '未配置'}`);

  const template = readFileSync(TEMPLATE_PATH, 'utf8');
  const html = render(template, {
    title,
    subtitle: `扫码打开 → 点按钮复制 → 切到小红书粘贴`,
    blocks,
    replies,
    pageUrl: `${BASE_URL}/${id}/`,
  });

  const outDir = resolve(DIST_DIR, id);
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, 'index.html');
  writeFileSync(outFile, html, 'utf8');

  return { id, outFile };
}

// 把 qrcode.min.js 拷到 dist 根，确保所有页面都能加载（无论子路径还是根）
function shipQrcodeLib() {
  if (!existsSync(QRCODE_LIB_SRC)) return;
  mkdirSync(DIST_DIR, { recursive: true });
  const dst = resolve(DIST_DIR, 'qrcode.min.js');
  writeFileSync(dst, readFileSync(QRCODE_LIB_SRC, 'utf8'), 'utf8');
}

// 渲染根路径：扫草稿箱 + 已发布，找 mtime 最新且有 publish_id 的那篇
function renderRootPage(vaultPath) {
  const candidates = [];
  const scanDirs = [
    resolve(vaultPath, '05.我的产品', '商品笔记', '草稿箱'),
    resolve(vaultPath, '05.我的产品', '商品笔记', '已发布'),
  ];
  for (const dir of scanDirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.md')) continue;
      const fp = resolve(dir, name);
      let content;
      try { content = readFileSync(fp, 'utf8'); } catch (_) { continue; }
      if (!getPublishId(content)) continue;
      const st = statSync(fp);
      candidates.push({ fp, mtime: st.mtimeMs, id: getPublishId(content) });
    }
  }
  if (!candidates.length) {
    info('草稿箱/已发布 没找到有 publish_id 的笔记，跳过根路径生成');
    return;
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  const latest = candidates[0];
  const latestName = latest.fp.split(/[\\\/]/).pop();
  info(`根路径：最近一篇 → ${latestName} (${latest.id})`);

  const content = readFileSync(latest.fp, 'utf8');
  const blocks  = extractAll(content);
  const replies = parseReplies(blocks.REPLIES.text);
  const title   = getTitleFromH1(content);
  const template = readFileSync(TEMPLATE_PATH, 'utf8');
  const html = render(template, {
    title,
    subtitle: `扫码打开 → 当前最新（自动同步）`,
    blocks,
    replies,
    pageUrl: `${BASE_URL}/`,
  });
  const outFile = resolve(DIST_DIR, 'index.html');
  mkdirSync(DIST_DIR, { recursive: true });
  writeFileSync(outFile, html, 'utf8');
  info(`根路径已生成：${outFile}`);
}

function cmdPublish(notePath) {
  if (!notePath) die('缺少笔记路径。示例：node publish.mjs publish "笔记.md"');
  const abs = resolve(notePath);
  if (!existsSync(abs)) die(`找不到笔记：${abs}`);

  const content = readFileSync(abs, 'utf8');
  const { outFile } = renderNotePage(content);

  shipQrcodeLib();

  info(`\n已生成：${outFile}`);
  info(`本地预览：http://localhost:4173/<id>/  （先运行 preview 命令）\n`);
}

function cmdShip(notePath) {
  if (!notePath) die('缺少笔记路径。示例：node publish.mjs ship "笔记.md"');
  const abs = resolve(notePath);
  if (!existsSync(abs)) die(`找不到笔记：${abs}`);

  const content = readFileSync(abs, 'utf8');
  const { id } = renderNotePage(content);

  // 根路径：需要 vault 路径
  const vaultPath = process.env.OBSIDIAN_VAULT || process.env.VAULT_PATH;
  if (vaultPath) renderRootPage(vaultPath);

  // 把 qrcode.min.js 拷到 dist/ 根，所有页面都能加载
  shipQrcodeLib();

  // git: 检查仓、add、commit、push
  if (!existsSync(resolve(__dirname, '.git'))) {
    info(`当前目录还不是 git 仓：${__dirname}`);
    info(`先初始化：git init && git remote add origin <repo-url>，然后重跑 ship`);
    return;
  }

  info('\n开始 git 操作...');

  function runGit(args, opts = {}) {
    const p = spawnSync('git', args, {
      cwd: __dirname,
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, GIT_PAGER: 'cat' },
      ...opts,
    });
    return p.status;
  }

  function runGitCapture(args) {
    // 不继承 stdio，纯捕获输出
    return spawnSync('git', args, {
      cwd: __dirname,
      encoding: 'utf8',
      shell: true,
      env: { ...process.env, GIT_PAGER: 'cat' },
    });
  }

  // git add -A 一次性 add 仓里所有变更（含未跟踪文件）
  // 比分次 add 稳：避开 Git Bash + 多参数 + 中文路径的拆错 bug
  // .gitignore 已配置好：node_modules/ test-fixtures/ 等会被自动排除
  const addCode = runGit(['add', '-A'], { stdio: 'pipe' });
  if (addCode !== 0) die(`git add 失败，退出码 ${addCode}`);

  // 检测是否有变更，没就不 commit 直接 push 当前 main
  const statusResult = runGitCapture(['status', '--porcelain']);
  if (!statusResult.stdout || !statusResult.stdout.trim()) {
    info('本地没有任何变更可 commit，跳过 commit，只 push 当前 main');
  } else {
    const msg = `ship: ${id}`;
    // 用 -m 加 commit message，避开 heredoc / 多行字符串
    const cmt = runGit(['commit', '-m', msg]);
    if (cmt !== 0 && cmt !== 1) {
      // 1 也可能是没有改变（已经被某种方式 fix 了），不当作错误
      die(`git commit 失败，退出码 ${cmt}`);
    }
  }

  const pushCode = runGit(['push', 'origin', 'main']);
  if (pushCode !== 0) die(`git push 失败，退出码 ${pushCode}`);
  info('\n✓ 已推送到 main。Vercel 会自动部署。');
}

function cmdPreview() {
  if (!existsSync(DIST_DIR)) {
    die(`dist/ 不存在，先运行 publish 命令生成内容。`);
  }
  // 用 npx serve 临时跑一个服务器；如果用户没装，回退到 python
  console.log(`\n启动本地预览：http://localhost:4173/\n`);
  const tries = [
    { cmd: 'npx', args: ['--yes', 'serve', 'dist', '-p', '4173', '-L'] },
    { cmd: 'python', args: ['-m', 'http.server', '4173', '--directory', 'dist'] },
  ];
  const t = tries[0];
  const p = spawn(t.cmd, t.args, { stdio: 'inherit', shell: true });
  p.on('error', () => {
    info('npx serve 不可用，尝试 python -m http.server');
    const p2 = spawn('python', ['-m', 'http.server', '4173'], { stdio: 'inherit', shell: true });
    p2.on('error', () => die('请先安装 Node.js 或 Python 来起预览服务'));
  });
}

// ====== 入口 ======
const [, , cmd, ...rest] = process.argv;
switch (cmd) {
  case 'publish': cmdPublish(rest[0]); break;
  case 'ship': cmdShip(rest[0]); break;
  case 'preview': cmdPreview(); break;
  case 'help':
  case '--help':
  case '-h':
  default: cmdHelp();
}
