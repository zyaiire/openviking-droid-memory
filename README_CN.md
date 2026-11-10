# OpenViking 记忆插件：Factory Droid

[English](README.md)

为本机 [Factory Droid](https://factory.ai/)（CLI，交互模式与 `droid exec`）提供长期记忆，后端是 [OpenViking](https://github.com/volcengine/OpenViking)。这是一个社区插件，基于上游 `examples/claude-code-memory-plugin`：共享的记忆运行时原样 vendor，本仓库只放 Droid 专有的 hook 入口、transcript 解码器和 MCP 启动器。

```sh
droid plugin marketplace add https://github.com/zyaiire/openviking-droid-memory
droid plugin install openviking-memory@openviking-droid-memory
```

要求：`~/.openviking/ovcli.conf` 里配置好 OpenViking 服务端（所有 OpenViking 集成都读这个文件），`PATH` 上有 Node 18+。从本地 checkout 安装时，把它的路径传给 `marketplace add`；`install` 加 `--scope project` 只对单个项目启用。

已在 Droid CLI 0.232.0 上验证。

## Hook 做什么

- **会话开始** — 注入用户画像与偏好，并重放离线会话排队的写入。Droid 在 `-s`、`--fork` 和 `/compress` 时也会触发它。
- **提交 prompt** — 搜索与 prompt 相关的记忆并注入。Droid 在 `droid exec` 下不触发这个 hook，所以 `exec` 运行有画像，没有逐条召回。
- **Stop** — 从 Droid 在 `transcript_path` 里指明的会话文件读出新的用户 prompt 和助手回复，发给 OpenViking。会话的待处理 token 达到 `commitTokenThreshold` 时 commit。
- **PreCompact 与 SessionEnd** — 先补发还没发出的回合，再 commit，让记忆得以提取。`droid exec`、`/exit` 和 Ctrl-C 都会触发 `SessionEnd`。

插件还提供 `openviking` MCP 服务（search、read、remember 等）和四个 skill：`openviking-memory`、`openviking-skills`、`ov-experience-memory`、`openviking-rule-search`。

所有 hook 都是 fail-open：OpenViking 不可用或出任何错，Droid 照常运行，插件不输出任何内容。服务端不可达时失败的写入会排队，之后重放。

## 配置

- 本客户端的设置写在 `ovcli.conf` 的 `plugin.droid` 下，例如 `{"plugin": {"droid": {"autoCapture": false}}}`。上游插件读取的 `OPENVIKING_*` 环境变量同样有效（`OPENVIKING_AUTO_RECALL`、`OPENVIKING_AUTO_CAPTURE`、`OPENVIKING_COMMIT_TOKEN_THRESHOLD` 等）。
- `OPENVIKING_MEMORY_ENABLED=0` 关闭插件；不设置时，只要存在 `ovcli.conf` 或 `ov.conf` 插件就启用。
- OpenViking 会话名为 `dr-<droid 会话 id>`。恢复的会话沿用原来的 OpenViking 会话；fork 是一个新的 Droid 会话，有自己的 OpenViking 会话，只捕获 fork 点之后的回合。
- 召回压缩默认关闭。上游的本地压缩器依赖 `claude` CLI，本插件不带。

## 目录结构

`plugin/` 是可安装的插件，仓库根目录是列出它的 marketplace。

- `plugin/hooks/hooks.json` 注册五个事件，各对应 `plugin/scripts/` 下的一个入口脚本：`session-start.mjs`、`auto-recall.mjs`、`auto-capture.mjs`、`pre-compact.mjs`、`session-end.mjs`。
- `plugin/scripts/droid-transcript.mjs` 把 Droid 的会话 JSONL 解码成回合；`plugin/scripts/lib/` 是三个捕获 hook 共用的捕获流程。
- `plugin/scripts/shared/`、`plugin/servers/mcp-proxy.mjs` 和 `plugin/skills/` 是未修改的上游文件，commit 与哈希记录在 [PIN.md](plugin/scripts/PIN.md)。
- `plugin/mcp.json` 通过一段内联启动器启动 MCP 代理，因为 Droid 不会在 MCP 配置里替换插件根目录。

## Droid 宿主说明

- 会话文件是权威 transcript，hook stdin 只是触发信号。每条记录自己的 `id` 就是 OpenViking 的 `turn_id`，重复捕获或恢复会话后再捕获都不会把同一回合发两次。
- 捕获沿主对话链进行：工具调用、thinking、hook 记录、注入的上下文和 Droid 自己的提示都不计入；`/compress` 之前的回合仍然可达。
- hook 只在有上下文要注入时才输出，因为 Droid 会把 prompt hook 的任何 stdout 当作上下文。
- 在 `droid exec` 下调用 MCP 工具需要 `--auto high`。
- 子代理（Task 工具）会话、Factory 云端会话、missions 和桌面应用不在本插件范围内。
- 回退（rewind）和编辑消息没有在 Droid 0.232.0 上实测。已经从被放弃分支发出的回合仍留在 OpenViking。

已验证的 Droid 扩展面以及由此做出的决策记录在 [DESIGN.md](DESIGN.md)。

## 诊断

```sh
droid mcp list                                        # 应看到：openviking  stdio  connected
OPENVIKING_DEBUG=1 droid exec "Reply with one word"   # 然后看 hook 日志
tail ~/.openviking/logs/droid-hooks.log
```

日志是 JSON Lines，每个 hook 阶段一条（`inject`、`push_turns`、`commit` 等）。上游的 doctor 不认识 `droid` 客户端，本插件不带。

## 测试

```sh
npm test
```

覆盖：用 Droid 实录 transcript 验证解码器、捕获游标、针对本地模拟 OpenViking 服务端的全部 hook（包括服务中断及其重放），以及打包和 vendor 文件哈希。

## 许可证

[Apache-2.0](LICENSE)。vendor 的 OpenViking 运行时来自上游 `examples/`，同为 Apache-2.0。
