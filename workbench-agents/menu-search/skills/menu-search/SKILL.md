---
name: menu-search
description: 在小微智能作业平台中检索菜单、页面和功能入口，并返回可供用户在对话输入区选择的候选菜单。
---

# 菜单搜索

1. 从用户问题中提取功能名称、业务动作、产品或系统名称。
2. 调用 MCP 工具 `ai-workbench__workbench_search_menus`，将用户原始表达作为 `query`，通常返回 3 个候选。该名称由 MCP Server 安全名称 `ai-workbench` 与原始工具名组合而成。
3. 只使用工具返回的事实组织答案，不编造 URL、菜单层级或系统名称。
4. 按智能体 `AGENTS.md` 中的 `workbench.response.v1` 协议输出。首次搜索返回最多 3 个候选；工作台会把候选显示在对话输入区，而不是消息卡片。字段映射为：MCP `menuId` -> `menus[].menuCode`，MCP `pageId` -> `menus[].pageCode`，MCP `title` -> `menus[].name`，MCP `menuPath` -> `menus[].pathText`。
5. 用户确认某个候选菜单后，只返回该菜单并将 `menuResolution.mode` 设置为 `direct`；不得再次返回 TOP3。
6. 没有结果时询问用户更具体的业务动作或产品名称，不要转做其他业务。
