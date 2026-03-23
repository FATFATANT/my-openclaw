# 智能表单填充 Skill

一个强大的 OpenClaw 技能，能够根据自然语言自动识别表单类型，提取字段，并调用对应的后端接口。

## 功能

1. **智能表单识别**: 自动识别用户想要操作的表单类型（客户信息、商品信息、预约信息）
2. **自然语言解析**: 从自然语言中提取字段值
3. **字段映射**: 将提取的信息映射到对应的接口字段
4. **接口调用**: 自动组装 JSON 请求体并调用后端接口
5. **智能推断**: 对缺失字段进行合理推断或提示用户补充

## 支持的接口

### 1. 客户信息表单

- **接口**: `POST http://localhost:8080/api/customers`
- **字段**:
  - `name` (客户姓名) - 必填
  - `phone` (客户电话) - 必填
  - `level` (客户等级) - 可选

### 2. 商品信息表单

- **接口**: `POST http://localhost:8080/api/products`
- **字段**:
  - `productName` (商品名称) - 必填
  - `price` (商品价格) - 必填
  - `stock` (库存数量) - 可选

### 3. 预约信息表单

- **接口**: `POST http://localhost:8080/api/appointments`
- **字段**:
  - `visitorName` (来访人姓名) - 必填
  - `appointmentDate` (预约日期) - 必填
  - `remark` (备注信息) - 可选

## 使用示例

### 示例 1: 新增客户

**用户输入**: "新增一个客户，姓名张三，电话13800138000，等级VIP"

**技能输出**:

```
识别到的表单类型: 客户信息表单
目标接口完整地址: http://localhost:8080/api/customers
提取出的字段内容:
  客户姓名(name): 张三
  客户电话(phone): 13800138000
  客户等级(level): VIP
组装后的 JSON 请求体:
{
  "name": "张三",
  "phone": "13800138000",
  "level": "VIP"
}
```

### 示例 2: 添加商品

**用户输入**: "添加商品：iPhone 15，价格6999元，库存100台"

**技能输出**:

```
识别到的表单类型: 商品信息表单
目标接口完整地址: http://localhost:8080/api/products
提取出的字段内容:
  商品名称(productName): iPhone 15
  商品价格(price): 6999
  库存数量(stock): 100
组装后的 JSON 请求体:
{
  "productName": "iPhone 15",
  "price": 6999,
  "stock": 100
}
```

## 安装

1. 复制此目录到 OpenClaw 的 skills 目录:

   ```bash
   cp -r smart-form-filler ~/.openclaw/skills/
   ```

2. 在 OpenClaw 中启用此技能

## 配置

编辑 `src/index.js` 中的 `CONFIG` 对象:

```javascript
const CONFIG = {
  baseUrl: "http://localhost:8080", // 后端服务地址
  timeout: 5000, // 请求超时时间(ms)
  headers: {
    "Content-Type": "application/json",
  },
};
```

## 测试

运行测试脚本:

```bash
node test.js
```

## 技术实现

1. **表单识别**: 基于关键词匹配算法
2. **字段提取**: 使用正则表达式和模式匹配
3. **自然语言处理**: 支持中文和混合语言输入
4. **错误处理**: 友好的错误提示和缺失字段检测

## 扩展性

可以轻松扩展支持更多表单类型:

1. 在 `FORM_TYPES` 对象中添加新的表单定义
2. 在 `FORM_KEYWORDS` 中添加识别关键词
3. 实现对应的字段提取逻辑

## 许可证

MIT
