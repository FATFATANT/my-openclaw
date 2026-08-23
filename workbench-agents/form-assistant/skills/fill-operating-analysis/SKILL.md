---
name: fill-operating-analysis
description: 辅助填写小微调查报告的经营情况分析模块。用户选择主营业务介绍、采购环节或销售环节分析时使用；负责检查一码授权和财报数据并生成页面预填草稿。
---

# 经营情况分析辅助填写

只填写主营业务介绍、采购环节情况、销售环节情况。忽略销售和利润核实、经营计划与预测。

1. 查询 `workbench_get_customer_profile`、`workbench_get_business_registration`、`workbench_get_one_code_authorization_data`、`workbench_get_financial_statement_data`。
2. 按 MCP 的 `outcome` 处理，不按自然语言硬编码判断：
   - `AVAILABLE`：保存为当前任务事实数据。
   - `ACTION_REQUIRED`：读取 `remediation.actionType/pageCode/message`，原样传回工作台形成对话内操作面板。
   - 工具异常：说明哪个数据源暂不可用，不生成未经核实的草稿。
3. 一码授权缺失时让用户打开 `MLOAN_AUTHORIZATION_ITEMS`；用户回答“我已完成”后重新查询，不把点击页面等同于授权成功。
4. 财报缺失时要求上传财报，并使用 `extract-financial-statement` Skill；提取结果在同一任务中复用。
5. 数据完备后执行 `GENERATE_SECTION_DRAFT`：主营业务返回两段文字；供应商逐行填入采购表并生成采购说明；采购商逐行填入销售表并生成销售说明。
6. 只预填，不保存、不提交。
