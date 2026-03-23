/**
 * 智能表单填充 Skill
 *
 * 功能：根据自然语言自动识别表单类型，提取字段，调用对应接口
 */

const https = require("https");
const http = require("http");

// 配置
const CONFIG = {
  baseUrl: "http://localhost:8080",
  timeout: 5000,
  headers: {
    "Content-Type": "application/json",
  },
};

// 表单定义
const FORM_TYPES = {
  CUSTOMER: {
    name: "客户信息表单",
    endpoint: "/api/customers",
    method: "POST",
    fields: {
      name: { description: "客户姓名", required: true, patterns: ["姓名", "名字", "客户名"] },
      phone: { description: "客户电话", required: true, patterns: ["电话", "手机", "联系方式"] },
      level: { description: "客户等级", required: false, patterns: ["等级", "级别", "VIP"] },
    },
  },
  PRODUCT: {
    name: "商品信息表单",
    endpoint: "/api/products",
    method: "POST",
    fields: {
      productName: {
        description: "商品名称",
        required: true,
        patterns: ["商品名称", "商品名", "产品名", "名称"],
      },
      price: {
        description: "商品价格",
        required: true,
        patterns: ["价格", "价钱", "售价", "单价"],
      },
      stock: { description: "库存数量", required: false, patterns: ["库存", "数量", "存货"] },
    },
  },
  APPOINTMENT: {
    name: "预约信息表单",
    endpoint: "/api/appointments",
    method: "POST",
    fields: {
      visitorName: {
        description: "来访人姓名",
        required: true,
        patterns: ["来访人", "访客", "姓名"],
      },
      appointmentDate: {
        description: "预约日期",
        required: true,
        patterns: ["日期", "时间", "预约时间"],
      },
      remark: { description: "备注信息", required: false, patterns: ["备注", "说明", "描述"] },
    },
  },
};

// 表单识别关键词
const FORM_KEYWORDS = {
  CUSTOMER: ["客户", "顾客", "consumer", "customer"],
  PRODUCT: ["商品", "产品", "product", "item"],
  APPOINTMENT: ["预约", "预定", "appointment", "booking"],
};

/**
 * 识别表单类型
 * @param {string} text - 用户输入的自然语言
 * @returns {object|null} 表单类型对象
 */
function identifyFormType(text) {
  if (!text) return null;

  const lowerText = text.toLowerCase();

  // 统计关键词出现次数
  const scores = {
    CUSTOMER: 0,
    PRODUCT: 0,
    APPOINTMENT: 0,
  };

  // 计算每个表单类型的关键词匹配分数
  for (const [formType, keywords] of Object.entries(FORM_KEYWORDS)) {
    keywords.forEach((keyword) => {
      if (lowerText.includes(keyword.toLowerCase())) {
        scores[formType]++;
      }
    });
  }

  // 找到分数最高的表单类型
  let maxScore = 0;
  let identifiedForm = null;

  for (const [formType, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      identifiedForm = formType;
    }
  }

  // 如果分数为0，尝试通过其他关键词推断
  if (maxScore === 0) {
    if (lowerText.includes("电话") || lowerText.includes("手机")) {
      identifiedForm = "CUSTOMER";
    } else if (lowerText.includes("价格") || lowerText.includes("价钱")) {
      identifiedForm = "PRODUCT";
    } else if (lowerText.includes("日期") || lowerText.includes("时间")) {
      identifiedForm = "APPOINTMENT";
    }
  }

  return identifiedForm ? FORM_TYPES[identifiedForm] : null;
}

/**
 * 从文本中提取字段值
 * @param {string} text - 用户输入的自然语言
 * @param {object} formType - 表单类型对象
 * @returns {object} 提取的字段值
 */
function extractFields(text, formType) {
  const extracted = {};
  const missing = [];

  for (const [fieldName, fieldConfig] of Object.entries(formType.fields)) {
    let value = null;

    // 尝试从文本中提取字段值
    for (const pattern of fieldConfig.patterns) {
      // 改进的正则表达式，匹配更灵活的模式
      const regexes = [
        // 模式1: "姓名：王敏" 或 "姓名:王敏"
        new RegExp(`${pattern}[：: ]+([^，,。.\\s]+)`, "i"),
        // 模式2: "姓名是王敏" 或 "姓名叫王敏"
        new RegExp(`${pattern}(?:是|叫)[：: ]*([^，,。.\\s]+)`, "i"),
        // 模式3: "王敏的姓名"
        new RegExp(`([^，,。.\\s]+)的${pattern}`, "i"),
        // 模式4: "姓名王敏"
        new RegExp(`${pattern}([^，,。.\\s]+)`, "i"),
        // 模式5: 更宽松的匹配
        new RegExp(`${pattern}[：: ]*([^，,。]+)`, "i"),
      ];

      for (const regex of regexes) {
        const match = text.match(regex);
        if (match && match[1]) {
          value = match[1].trim();
          // 清理值：移除标点符号和多余的"是"、"叫"等词
          value = value.replace(/[，,。.]$/, "");
          value = value.replace(/^(是|叫|还有?)[：: ]*/, "");
          break;
        }
      }

      if (value) break;
    }

    // 如果没找到，尝试其他提取方式
    if (!value) {
      // 尝试提取数字（价格、库存等）
      if (fieldName === "price" || fieldName === "stock") {
        // 针对不同字段使用不同的提取策略
        if (fieldName === "price") {
          // 价格提取：查找"价格"、"单价"、"售价"等关键词
          const priceMatches = [
            text.match(/(?:价格|单价|售价)[：: ]*(?:是|为)?[：: ]*(\d+(?:\.\d+)?)/i),
            text.match(/(\d+(?:\.\d+)?)[元块]/),
            text.match(/(\d+(?:\.\d+)?)(?:元|块)/),
          ];

          for (const match of priceMatches) {
            if (match && match[1]) {
              value = match[1];
              break;
            }
          }
        }

        if (fieldName === "stock" && !value) {
          // 库存提取：查找"库存"、"数量"、"件"等关键词
          const stockMatches = [
            text.match(/(?:库存|数量)[：: ]*(?:还有?)?[：: ]*(\d+)/i),
            text.match(/(\d+)[件台个]/),
            text.match(/(\d+)(?:件|台|个)/),
          ];

          for (const match of stockMatches) {
            if (match && match[1]) {
              value = parseInt(match[1]);
              break;
            }
          }

          // 如果提取的值包含单位，清理它
          if (typeof value === "string") {
            const numMatch = value.match(/(\d+(?:\.\d+)?)/);
            if (numMatch) {
              // 保留原始字符串，不转换为数字
              value = numMatch[1];
            }
          }
        }

        // 如果还没找到，尝试通用数字提取
        if (!value) {
          const allNumMatches = text.match(/\d+(?:\.\d+)?/g);
          if (allNumMatches && allNumMatches.length > 0) {
            // 根据字段类型选择数字
            if (fieldName === "price" && allNumMatches.length >= 2) {
              // 价格通常是第二个数字（第一个可能是商品编号）
              value = parseFloat(allNumMatches[1]);
            } else {
              // 取最后一个数字
              value = parseFloat(allNumMatches[allNumMatches.length - 1]);
            }
          }
        }
      }

      // 尝试提取日期
      if (fieldName === "appointmentDate") {
        const dateMatch = text.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2})|(今天|明天|后天)/);
        if (dateMatch) {
          value = dateMatch[1] || dateMatch[2];
          // 简单转换相对日期
          if (value === "今天") value = new Date().toISOString().split("T")[0];
          if (value === "明天") {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            value = tomorrow.toISOString().split("T")[0];
          }
          if (value === "后天") {
            const dayAfter = new Date();
            dayAfter.setDate(dayAfter.getDate() + 2);
            value = dayAfter.toISOString().split("T")[0];
          }
        }
      }

      // 尝试提取姓名（客户姓名、来访人姓名）
      if (fieldName === "name" || fieldName === "visitorName") {
        // 查找常见的姓名模式
        const nameMatch = text.match(/(?:姓名|名字|客户名|来访人)[：: ]*([\u4e00-\u9fa5]{2,4})/i);
        if (nameMatch) {
          value = nameMatch[1];
        } else {
          // 查找"张三"、"李四"这样的模式
          const chineseNameMatch = text.match(/([\u4e00-\u9fa5]{2,4})[，,。]/);
          if (chineseNameMatch) {
            value = chineseNameMatch[1];
          }
        }
      }

      // 尝试提取电话
      if (fieldName === "phone") {
        const phoneMatch = text.match(/(?:电话|手机)[：: ]*(\d{11})/i);
        if (phoneMatch) {
          value = phoneMatch[1];
        } else {
          const anyPhoneMatch = text.match(/(1[3-9]\d{9})/);
          if (anyPhoneMatch) value = anyPhoneMatch[1];
        }
      }

      // 尝试提取商品名称
      if (fieldName === "productName") {
        // 查找"商品名称是XXX"或"商品名XXX"模式
        const productMatches = [
          { pattern: /商品名称[：: ]*(?:是|叫)?[：: ]*([^，,。]+)/i, priority: 1 },
          { pattern: /商品名[：: ]*(?:是|叫)?[：: ]*([^，,。]+)/i, priority: 2 },
          { pattern: /产品名[：: ]*(?:是|叫)?[：: ]*([^，,。]+)/i, priority: 2 },
          { pattern: /商品[：: ]*(?:名称)?(?:是|叫)?[：: ]*([^，,。]+)/i, priority: 3 },
          { pattern: /([^，,。]+)商品/i, priority: 4 },
        ];

        // 按优先级排序
        productMatches.sort((a, b) => a.priority - b.priority);

        for (const { pattern } of productMatches) {
          const match = text.match(pattern);
          if (match && match[1]) {
            value = match[1].trim();
            // 清理值
            value = value.replace(/^(是|叫|还有?)[：: ]*/, "");
            value = value.replace(/[，,。.]$/, "");
            // 移除可能的单位或描述
            value = value.replace(/(?:单价|价格|库存).*$/, "");
            value = value.trim();
            break;
          }
        }

        // 如果还没找到，尝试提取"机械键盘"这样的模式
        if (!value) {
          const commonProducts = ["机械键盘", "iPhone", "MacBook", "iPad", "华为", "小米", "三星"];
          for (const product of commonProducts) {
            if (text.includes(product)) {
              value = product;
              break;
            }
          }
        }
      }
    }

    if (value) {
      extracted[fieldName] = value;
    } else if (fieldConfig.required) {
      missing.push(fieldConfig.description);
    }
  }

  return { extracted, missing };
}

/**
 * 发送 HTTP 请求
 * @param {string} url - 请求URL
 * @param {object} data - 请求数据
 * @returns {Promise<object>} 响应结果
 */
function sendRequest(url, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === "https:";
    const module = isHttps ? https : http;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers: {
        ...CONFIG.headers,
        "Content-Length": Buffer.byteLength(JSON.stringify(data)),
      },
    };

    const req = module.request(options, (res) => {
      let responseData = "";

      res.on("data", (chunk) => {
        responseData += chunk;
      });

      res.on("end", () => {
        try {
          const parsed = responseData ? JSON.parse(responseData) : {};
          resolve({
            statusCode: res.statusCode,
            data: parsed,
            headers: res.headers,
          });
        } catch (error) {
          resolve({
            statusCode: res.statusCode,
            data: responseData,
            error: "Failed to parse JSON response",
          });
        }
      });
    });

    req.on("error", (error) => {
      reject(error);
    });

    req.setTimeout(CONFIG.timeout, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });

    req.write(JSON.stringify(data));
    req.end();
  });
}

/**
 * 处理用户消息
 * @param {string} message - 用户消息
 * @param {object} context - 上下文
 * @returns {Promise<string>} 处理结果
 */
async function handleMessage(message, context = {}) {
  try {
    // 1. 识别表单类型
    const formType = identifyFormType(message);
    if (!formType) {
      return "无法识别表单类型。请明确说明是客户信息、商品信息还是预约信息。";
    }

    // 2. 提取字段
    const { extracted, missing } = extractFields(message, formType);

    // 3. 检查必填字段
    if (missing.length > 0) {
      return `识别到${formType.name}，但缺少以下必填字段：${missing.join("、")}。请补充完整信息。`;
    }

    // 4. 组装请求数据，并确保格式正确
    const requestData = { ...extracted };

    // 格式化字段
    if (formType.name === "商品信息表单") {
      // 价格应该是数字
      if (requestData.price) {
        requestData.price = parseFloat(requestData.price) || requestData.price;
      }
      // 库存应该是数字，移除单位
      if (requestData.stock && typeof requestData.stock === "string") {
        const numMatch = requestData.stock.match(/(\d+)/);
        if (numMatch) {
          requestData.stock = parseInt(numMatch[1]);
        }
      }
    }

    // 客户等级如果是字符串，保持原样
    if (formType.name === "客户信息表单" && requestData.level) {
      requestData.level = String(requestData.level);
    }

    // 预约日期保持字符串格式
    if (formType.name === "预约信息表单" && requestData.appointmentDate) {
      requestData.appointmentDate = String(requestData.appointmentDate);
    }

    const fullUrl = CONFIG.baseUrl + formType.endpoint;

    // 5. 构建响应信息
    let response = `识别到的表单类型: ${formType.name}\n`;
    response += `目标接口完整地址: ${fullUrl}\n`;
    response += `提取出的字段内容:\n`;

    for (const [fieldName, value] of Object.entries(extracted)) {
      const fieldDesc = formType.fields[fieldName].description;
      response += `  ${fieldDesc}(${fieldName}): ${value}\n`;
    }

    response += `组装后的 JSON 请求体:\n${JSON.stringify(requestData, null, 2)}`;

    // 6. 实际调用接口（可选，根据配置决定）
    const shouldCallApi = context.callApi !== false; // 默认调用

    if (shouldCallApi) {
      try {
        const apiResponse = await sendRequest(fullUrl, requestData);
        response += `\n\n接口调用结果:\n状态码: ${apiResponse.statusCode}\n响应: ${JSON.stringify(apiResponse.data, null, 2)}`;
      } catch (error) {
        response += `\n\n接口调用失败: ${error.message}`;
      }
    } else {
      response += `\n\n（模拟模式，未实际调用接口）`;
    }

    return response;
  } catch (error) {
    return `处理失败: ${error.message}`;
  }
}

/**
 * 检查是否触发此技能
 * @param {string} message - 用户消息
 * @returns {boolean} 是否触发
 */
function shouldTrigger(message) {
  if (!message) return false;

  const lowerMessage = message.toLowerCase();
  const triggerKeywords = [
    "新增",
    "添加",
    "创建",
    "录入",
    "form",
    "add",
    "create",
    "客户",
    "商品",
    "预约",
    "customer",
    "product",
    "appointment",
  ];

  return triggerKeywords.some((keyword) => lowerMessage.includes(keyword.toLowerCase()));
}

// 导出模块
module.exports = {
  name: "smart-form-filler",
  version: "1.0.0",
  description: "智能表单填充技能 - 根据自然语言自动识别表单类型并调用接口",

  // 配置
  config: CONFIG,

  // 表单定义（导出供测试使用）
  formTypes: FORM_TYPES,

  // 技能方法
  shouldTrigger,
  handleMessage,
  identifyFormType,
  extractFields,
  sendRequest,

  // 生命周期方法
  onEnable: function () {
    console.log("智能表单填充技能已启用！");
  },

  onDisable: function () {
    console.log("智能表单填充技能已禁用。");
  },

  // 测试方法
  test: async function () {
    console.log("测试智能表单填充技能:");

    const testCases = [
      "新增一个客户，姓名张三，电话13800138000，等级VIP",
      "添加商品：iPhone 15，价格6999元，库存100台",
      "创建预约：来访人李四，预约日期2024-12-25，备注带身份证",
      "录入客户信息，名字王五，手机13900139000",
      "我要添加一个商品，商品名MacBook Pro，价格12999",
    ];

    for (const testCase of testCases) {
      console.log(`\n测试输入: "${testCase}"`);

      if (shouldTrigger(testCase)) {
        const formType = identifyFormType(testCase);
        console.log(`  识别表单: ${formType ? formType.name : "未知"}`);

        if (formType) {
          const { extracted, missing } = extractFields(testCase, formType);
          console.log(`  提取字段:`, extracted);
          if (missing.length > 0) {
            console.log(`  缺失字段:`, missing);
          }
        }
      } else {
        console.log(`  不触发此技能`);
      }
    }

    return true;
  },
};
