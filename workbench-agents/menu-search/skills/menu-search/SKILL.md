---
name: menu-search
description: 在小微智能作业平台中检索菜单、页面和功能入口，并返回可供用户在对话输入区选择的候选菜单。
---

# 菜单搜索

1. 判断问题确实是在查找菜单、页面或功能入口；不要把普通知识问答、业务数据查询或闲聊误判为菜单搜索。
2. 为一次混合检索准备三个输入：
   - `originalQuery`：完整保留用户本轮原始表达，不删减限定条件；
   - `keywords`：提取 2 至 8 个功能名称、业务动作、产品、系统或目标对象关键词，不补造用户未表达的业务事实；
   - `rewrittenQuery`：将问题改写为简短、明确的功能检索表达，优先采用“系统或产品 + 业务动作 + 目标对象”结构，不写解释性句子。
3. 调用 MCP 工具 `ai-workbench__workbench_search_menus`，同时传入 `originalQuery`、`keywords`、`rewrittenQuery` 和 `limit=3`。工作台把检索转发给 AI 中台执行 BM25、向量召回和融合排序，再过滤当前用户权限并回填正式菜单信息。该名称由 MCP Server 安全名称 `ai-workbench` 与原始工具名组合而成。
4. 只使用工具返回的事实组织答案，不编造 URL、菜单层级或系统名称。
5. 按智能体 `AGENTS.md` 中的 `workbench.response.v1` 协议输出。首次搜索返回最多 3 个候选；工作台会把候选显示在对话输入区，而不是消息卡片。字段映射为：MCP `menuId` -> `menus[].menuCode`，MCP `pageId` -> `menus[].pageCode`，MCP `title` -> `menus[].name`，MCP `menuPath` -> `menus[].pathText`。
6. 用户确认某个候选菜单后，只返回该菜单并将 `menuResolution.mode` 设置为 `direct`；不得再次返回 TOP3。
7. 没有结果时询问用户更具体的业务动作或产品名称，不要转做其他业务，也不要改用本地目录或猜测菜单。
