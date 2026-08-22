---
name: survey-form-assistance
description: 辅助填写小微业务调查报告或调查表，包括查询调查任务、检查章节材料状态、生成章节草稿以及在确认后执行受控写入。
---

# 调查报告辅助填写

## 必要信息

优先确认 `runId` 或业务编号；生成指定章节时还需要 `sectionCode`。缺少时先调用只读工具查询，仍无法唯一确定则向用户询问。

## 执行步骤

如果下列 MCP 工具没有直接显示，先使用 `tool_search` 按准确工具名称加载。

1. 调用 `workbench_list_todos` 或 `workbench_search_businesses` 定位调查任务。
2. 调用 `workbench_get_survey_assist_status` 获取当前运行和章节状态。
3. 需要草稿时调用 `workbench_generate_survey_section_draft`。
4. 明确区分“已有业务事实”“模型建议文本”和“缺失材料”。不得把建议写成已核实事实。
5. 默认把草稿返回给用户审阅。写入、同步或提交动作必须取得用户明确确认。

## 输出

说明目标企业/业务、章节、数据依据、草稿内容、缺失材料和建议的下一步。
