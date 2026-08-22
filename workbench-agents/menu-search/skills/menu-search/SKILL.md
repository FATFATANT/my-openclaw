---
name: menu-search
description: 在小微智能作业平台中检索菜单、页面和功能入口，并返回可供用户选择的菜单卡片。
---

# 菜单搜索

1. 从用户问题中提取功能名称、业务动作、产品或系统名称。
2. 调用 MCP 工具 `workbench_search_menus`，将用户原始表达作为 `query`，通常返回 3 个候选。如果该工具未直接显示，先用 `tool_search` 按此名称加载它。
3. 只使用工具返回的事实组织答案，不编造 URL、菜单层级或系统名称。
4. 按智能体 `AGENTS.md` 中的 `workbench.response.v1` 协议输出。字段映射为：MCP `menuId` -> `menus[].menuCode`，MCP `pageId` -> `menus[].pageCode`，MCP `title` -> `menus[].name`，MCP `menuPath` -> `menus[].pathText`。
5. 没有结果时询问用户更具体的业务动作或产品名称，不要转做其他业务。
