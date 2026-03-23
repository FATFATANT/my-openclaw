// 测试智能表单填充技能
const skill = require("./src/index.js");

console.log("=== 测试智能表单填充技能 ===\n");

// 测试技能信息
console.log("技能信息:");
console.log(`  名称: ${skill.name}`);
console.log(`  版本: ${skill.version}`);
console.log(`  描述: ${skill.description}\n`);

// 测试表单识别
console.log("表单识别测试:");
const testCases = [
  {
    input: "新增一个客户，姓名张三，电话13800138000，等级VIP",
    expectedForm: "客户信息表单",
  },
  {
    input: "添加商品：iPhone 15，价格6999元，库存100台",
    expectedForm: "商品信息表单",
  },
  {
    input: "创建预约：来访人李四，预约日期2024-12-25，备注带身份证",
    expectedForm: "预约信息表单",
  },
  {
    input: "录入客户信息，名字王五，手机13900139000",
    expectedForm: "客户信息表单",
  },
  {
    input: "我要添加一个商品，商品名MacBook Pro，价格12999",
    expectedForm: "商品信息表单",
  },
  {
    input: "明天预约张三来访",
    expectedForm: "预约信息表单",
  },
  {
    input: "今天天气怎么样", // 不应该触发
    expectedForm: null,
  },
];

let passed = 0;
let total = 0;

testCases.forEach((testCase, index) => {
  total++;
  console.log(`\n测试 ${index + 1}: "${testCase.input}"`);

  // 测试触发检测
  const shouldTrigger = skill.shouldTrigger(testCase.input);
  console.log(`  触发检测: ${shouldTrigger ? "✅ 触发" : "❌ 不触发"}`);

  if (shouldTrigger) {
    // 测试表单识别
    const formType = skill.identifyFormType(testCase.input);
    const formName = formType ? formType.name : "未知";
    const isCorrect = formName === testCase.expectedForm;

    console.log(
      `  表单识别: ${formName} ${isCorrect ? "✅" : "❌ (预期: " + testCase.expectedForm + ")"}`,
    );

    if (formType) {
      // 测试字段提取
      const { extracted, missing } = skill.extractFields(testCase.input, formType);
      console.log(`  字段提取:`, extracted);
      if (missing.length > 0) {
        console.log(`  缺失字段:`, missing);
      }

      // 测试完整处理（模拟模式，不实际调用API）
      console.log(`  完整处理测试:`);
      skill
        .handleMessage(testCase.input, { callApi: false })
        .then((response) => {
          console.log(`  响应预览: ${response.substring(0, 100)}...`);
        })
        .catch((error) => {
          console.log(`  处理错误: ${error.message}`);
        });
    }

    if (isCorrect) passed++;
  } else {
    if (testCase.expectedForm === null) {
      console.log(`  表单识别: 不触发（符合预期）✅`);
      passed++;
    } else {
      console.log(`  表单识别: 应该触发但未触发 ❌`);
    }
  }
});

console.log(`\n=== 测试结果 ===`);
console.log(`通过: ${passed}/${total} (${Math.round((passed / total) * 100)}%)`);

// 运行技能自带的测试
console.log("\n=== 运行技能自带的测试 ===");
skill.test().then(() => {
  console.log("\n=== 测试完成 ===");
});
