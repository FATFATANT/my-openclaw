---
name: survey-form-assistance
description: 辅助填写小微业务调查报告或调查表，包括查询调查任务、检查章节材料状态、生成章节草稿以及在确认后执行受控写入。
---

# 调查报告辅助填写

## 多轮信息补齐

不要要求用户一次性提供完整参数。按以下顺序逐项补齐：客户 → 调查报告 → 辅助模块 → 模块材料/授权 → 草稿与页面预填。

## 执行步骤

如果下列 MCP 工具没有直接显示，先使用 `tool_search` 按准确工具名称加载。

1. 用户只说“帮我填调查报告”且没有客户时，直接追问客户名称。这一步严禁调用任何 MCP，严禁查待办/业务反推客户，严禁使用默认客户。
2. 用户给出客户名称或简称后，调用 `ai-workbench__workbench_search_customers`。唯一结果返回确认/取消的 `interaction`；多个结果返回完整候选 `interaction`；工作台会把它们显示在输入区，AI 消息区只显示普通文本“等待你的回答”。没有结果时请用户换关键词。
3. 用户确认客户后调用 `ai-workbench__workbench_search_survey_reports`，通过同一输入区选择协议返回该客户名下全部报告，不替用户默认选择最新一期。
4. 用户选定报告后调用 `ai-workbench__workbench_start_assistance`，`taskCode` 固定为 `LATEST_SURVEY_REPORT_ASSIST_FLOW`，`inputs` 必须同时包含 `customerName`、`customerNo`、`reportId`。返回任务状态后，工作台会立即打开该报告页面并让用户在输入区选择模块。
5. 有 `runId` 时调用 `ai-workbench__workbench_get_assistance_state`，只从 `availableActions` 中选择下一动作。
6. 用户选择模块后调用 `ai-workbench__workbench_execute_assistance_action` 执行 `CHECK_SECTION_DATA`。借款人基本信息使用 `fill-borrower-basic-info`；经营情况分析使用 `fill-operating-analysis`。页面上传走 `WORKBENCH_UI`；用户点击已完成授权后，用 `authorizationCompleted=true` 再执行 `CHECK_SECTION_DATA`。每次动作结果都必须通过 `assistantTask.startResult` 完整传回工作台。
7. 状态进入 `GENERATE_SECTION` 后执行 `GENERATE_SECTION_DRAFT`。最终返回的 `fields` 是页面 SDK 的输入，只能预填，不得自动保存或提交。
8. 明确区分“已有业务事实”“模型建议文本”和“缺失材料”。不得把建议写成已核实事实。
9. 默认把草稿返回给用户审阅。写入、同步或提交动作必须取得用户明确确认。

## 模块要求

- `BORROWER_BASIC_INFO` / 借款人基本信息：调用客户信息和工商信息 MCP；忽略内外负面信息说明。
- `OPERATING_ANALYSIS` / 经营情况分析：必须同时具备财报数据和一码授权数据；只填写主营业务、采购环节和销售环节。财报缺失时使用 `extract-financial-statement`。
- `FINANCING_BORROWING` 暂不支持，不展示、不生成草稿。

新增调查报告模块时，在本节增加 `sectionCode` 及所需数据类型，后端的 `QUERY_SURVEY_SECTION_STATUS` 返回对应 `missingDataItems.actionType`（`UPLOAD` / `AUTHORIZE` / 后续可扩展类型），前端依据动作类型通用渲染，不为每个模块重新复制工作流。

## 输出

严格按智能体 `AGENTS.md` 的 `workbench.response.v1` 输出；首次任务和后续每次状态/动作结果都必须原样携带在 `assistantTask.startResult`，让工作台始终更新同一个 `runId`。
