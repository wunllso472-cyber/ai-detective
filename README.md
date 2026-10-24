# 福尔摩搜 · AI侦探社

> 少点幻觉，多点搜索：用 **元宝搜索** 做会查的 AI。输入一个问题 → 找到多方来源 → 结论有依据 → 来源可追溯。

AI切磋大会 · 1024 超能 Coding 周末 · 「侦探」赛题作品。

## 功能

| 功能 | 说明 |
|---|---|
| 🔍 **查证** | 把问题拆成可核查的主张 → 元宝搜索多路并发检索（全网 / 权威垂直 `Mode=1` / 垂直领域 `Industry` / 反方辟谣 / 找出处）→ 逐条判断支持或反驳 → 溯源 → 打分 → 给出带 `[S编号]` 引用的结论 |
| 🛡 **防幻觉** | 模型给出的每条“支持 / 反驳”都必须附带一句原文，程序会在来源文本中**逐字校验**，找不到就拦截，不计入证据；结论里引用的编号也会校验 |
| ⛓ **溯源** | 按 `date` 排时间线；文本相似的来源合并成“同源转载组”，同组只算 1 个独立信源；再用 `Freshness` 搜更早的时间窗口，尝试找到真正的首发 |
| 🕵 **深度调查**（进阶） | 多轮执行“检索 → 核对 → 找证据缺口 → 补充检索”，最后生成调查报告（摘要、逐条核查、各方说法、时间线、存疑点、调查过程、参考来源），可下载 Markdown 或打印成 PDF |
| 👁 **持续盯梢**（进阶） | 对任意结论开启盯梢，调度器按间隔用 `Freshness=d1` 增量检索；出现新证据或结论变化时生成网页内提醒（铃铛角标 + 右下角弹窗） |
| 🖼 **截图查证**（进阶） | 上传、拖入或粘贴截图 → 视觉模型识别文字、核心说法、发布者和图中时间 → 走查证流程 → 做“截图一致性检查”（发布者能否搜到、时间是否对得上、像官方发布却搜不到官方原文时给出提示） |
| 🧩 **Skill 形态** | `skill/ai-detective/` 是 Claude Code Skill，零依赖脚本，调用本服务的 API |

判定分四档：**有据可查 / 存疑 / 与证据不符 / 证据不足**。判定由规则打分得出，综合考虑独立信源数、来源分级、支持与反驳的比例；模型只负责写解释，不能改判定。

## 快速开始

```bash
npm install
cp .env.example .env.local   # 填入密钥（不填就自动进入模拟模式，可以先看界面效果）
npm run dev                  # http://localhost:3000
# 或生产模式：npm run build && npm start
```

### 环境变量（`.env.local`）

| 变量 | 说明 |
|---|---|
| `TENCENTCLOUD_SECRET_ID` / `TENCENTCLOUD_SECRET_KEY` | 元宝搜索（腾讯云 wsa `SearchPro`，版本 `2025-05-08`）密钥，使用官方 SDK 签名 |
| `ARK_API_KEY` | 火山引擎方舟 API Key |
| `ARK_MODEL` | 文本模型，填模型 ID 或推理接入点 ID（`ep-xxxx`），默认 `doubao-seed-1-6-250615` |
| `ARK_VISION_MODEL` | 截图查证用的视觉模型，不填时与 `ARK_MODEL` 相同（必须支持图片输入） |
| `ARK_THINKING` | 默认 `disabled`，即关闭深度思考以提速；模型不支持这个参数时会自动去掉 |
| `WATCH_TICK_SECONDS` / `WATCH_INTERVAL_MINUTES` | 盯梢调度器的检查频率（默认 60 秒）/ 新盯梢任务的默认间隔（默认 60 分钟） |
| `PUBLIC_BASE_URL` | 部署在反向代理后面时，Skill 输出里的链接使用这个地址 |
| `DATA_DIR` | 数据目录，默认 `./data`（存查证结果、报告、盯梢任务、通知和搜索缓存） |

页面右上角会显示当前引擎状态（模拟 / 真实 + 元宝搜索版本）。当前按**标准版**设计：标准版支持 `Mode` / `Cnt` / `Industry`，不返回旗舰版的 `authority_level`，来源分级改用内置的域名规则。如果检测到极速版，会自动去掉不支持的参数。

## Skill

```bash
# 安装到 Claude Code（个人级）
cp -r skill/ai-detective ~/.claude/skills/
# 服务地址默认 http://localhost:3000；连已部署的服务时：
export DETECTIVE_API=https://你的域名
```

在 Claude Code 里直接问“这条消息是真的吗：……”或者“帮我查证这张截图”，就会触发这个 Skill。也可以手动运行：

```bash
node skill/ai-detective/scripts/detective.mjs verify "喝咖啡会致癌吗"
node skill/ai-detective/scripts/detective.mjs deep "阿斯巴甜致癌风波" --rounds 3
node skill/ai-detective/scripts/detective.mjs screenshot ./shot.png
node skill/ai-detective/scripts/detective.mjs watch <结果ID>
node skill/ai-detective/scripts/detective.mjs notifications
```

项目里另有一个直连 core 的开发用 CLI，不需要启动服务：`node cli/detective.mjs verify "……"`。

## 交付物录制指南

| 交付物 | 操作 |
|---|---|
| 3 次真实查询 | 「查证」标签分别查：一条已证实的消息、一条网传谣言、一条半真半假的说法。录屏里要出现结论屏、带引用的结论（鼠标悬停 `[S]` 会显示原文）、溯源时间线和来源清单 |
| 调查报告 | 「深度调查」→ 完成后点「打开调查报告」→「打印 / 存为 PDF」 |
| 提醒截图 | 在结果上点「持续盯梢」→ 切到「持续盯梢」标签 → 选择“最近 7 天”→「立即检查」→ 截下右下角弹窗和提醒列表（也可以设 `WATCH_INTERVAL_MINUTES=1`，演示自动触发） |
| 截图查证录屏 | 「截图查证」标签 → Ctrl+V 粘贴一张网传截图 → 录制识别、查证、一致性检查的全过程 |

## 目录结构

```
core/            查证引擎（纯 ESM，Web 和 CLI 共用）
  search.mjs     元宝搜索适配：SDK 调用、Pages 二次解析、版本降级、限流重试、缓存、模拟数据
  llm.mjs        火山方舟 OpenAI 兼容接口，JSON 容错解析
  case.mjs       查证主流程：拆解 / 搜索 / 核对（逐字校验）/ 溯源 / 打分 / 结论
  deep.mjs       深度调查与报告
  screenshot.mjs 截图查证与一致性检查
  watch.mjs      持续盯梢、调度器、通知
  sources.mjs    URL 规范化、来源分级、相似度分组
  store.mjs      JSON 文件存储
app/             Next.js 页面与 API（SSE 流式进度）
skill/           Claude Code Skill
cli/             开发用 CLI
```

## 部署注意

- 需要 Node.js 20.12+，`npm run build && npm start`。
- 盯梢调度器在 Web 进程内运行（`instrumentation.js`），请**单实例**部署，并把 `DATA_DIR` 挂载为持久化目录。
- 深度调查请求可能持续数分钟，反向代理的读超时要设到 10 分钟以上，并关闭 SSE 缓冲（接口已经带了 `X-Accel-Buffering: no`）。
