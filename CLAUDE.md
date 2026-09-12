# CLAUDE.md — 脑梗康复助手

**硬约定、验证命令、改完之后要做的事，全部见 [`AGENTS.md`](AGENTS.md)。请现在就去读那一份。**

这里故意不再重复一份内容。此前两份各自演进过一段时间，结果分叉出了真错误：这边漏掉了「隐私红线」（不得加数据上传/埋点/第三方脚本），又写着 `overlayPop()`——那个函数在 v0.2.22 之后就不存在了，照着写必然出错。任何 AI 工具（Claude Code / Codex / Cursor 等）都读 `AGENTS.md` 这一份，**不要把内容拷回本文件**。

接手顺序：`AGENTS.md`（硬约定）→ `docs/HANDOVER.md`（交接状态与未验证项）→ `docs/DEVELOPMENT.md`（架构、数据模型、扩展方法）；改医学内容前必读 `docs/RESEARCH.md` §八。
