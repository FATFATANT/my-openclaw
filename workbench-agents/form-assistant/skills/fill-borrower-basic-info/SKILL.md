---
name: fill-borrower-basic-info
description: 辅助填写小微调查报告的借款人基本信息模块。用户选择借款人基本信息，或要求填写企业基本信息、资本构成、经营稳定性、法定代表人信息时使用。
---

# 借款人基本信息辅助填写

1. 调用 `ai-workbench__workbench_get_customer_profile` 获取基本信息及法定代表人字段。
2. 调用 `ai-workbench__workbench_get_business_registration` 获取股东资本构成、经营年限及近两年工商变更。
3. 不填写“内外负面信息说明”。不得用模型猜测缺失事实。
4. 两个 MCP 都成功后，执行当前辅助任务的 `GENERATE_SECTION_DRAFT`；将完整动作结果放入 `assistantTask.startResult`。
5. 页面字段只能预填，不保存、不提交，并提示用户人工核对。

该模块不依赖财报上传或一码授权，不要触发公共财报提取 Skill。
