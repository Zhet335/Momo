# MVP Architecture

## 产品目标

做一款低成本、轻量、常驻桌面的 AI 电脑桌宠，优先满足这三类高频场景：

- 陪伴式对话：随点随聊，常驻桌面，不打断工作
- 文档助手：拖入文件后可以总结、提炼和问答
- 轻量提醒：提醒事项、待办和简单主动关怀

## 核心模块

### 1. 桌宠壳层

职责：

- 常驻桌面角落
- 支持拖动
- 支持点击展开/收起聊天面板
- 托盘驻留与退出
- 保持轻量、低打扰

建议实现：

- 一个透明、无边框、置顶但不过度抢焦点的小窗体
- 一个独立的聊天面板窗口
- 一个系统托盘入口

### 2. 对话引擎

职责：

- 管理用户消息和 AI 回复
- 维护会话上下文
- 调用智谱 API
- 后续支持工具调用

建议实现：

- 封装 `ZhipuClient`
- 在主进程统一管理敏感配置与 API Key
- 渲染进程只通过 IPC 发起对话请求

### 3. 文件分析模块

职责：

- 导入 PDF、DOCX、TXT 等文件
- 提取文本
- 对提取内容进行总结、问答、重点整理

建议实现：

- 先只做纯文本抽取
- 对超长文本做分段摘要
- 结果进入聊天上下文，用户继续追问

### 4. 提醒与待办模块

职责：

- 新增待办
- 设置提醒时间
- 到点弹通知
- 查看已完成和未完成状态

建议实现：

- SQLite 存储提醒、待办和状态
- 使用本地调度器触发通知
- 先做单次提醒，后面再扩展周期提醒

## 推荐架构

```text
React Renderer
  ├─ Chat UI
  ├─ Pet UI
  ├─ File Panel
  └─ Todo Panel
        │
        ▼
Preload API
        │
        ▼
Electron Main Process
  ├─ Window Manager
  ├─ IPC Router
  ├─ Zhipu Service
  ├─ File Parser Service
  ├─ Reminder Scheduler
  └─ SQLite Repository
```

## 进程职责划分

### 主进程

负责：

- 窗口生命周期
- 托盘
- 系统通知
- 文件读取
- 数据库存储
- 外部 API 调用

原因：

- 更安全
- 更适合处理本地系统能力
- 方便保护 API Key

### 渲染进程

负责：

- 桌宠视觉表现
- 聊天界面
- 文件导入交互
- 提醒与待办展示

## 数据流设计

### 对话流程

1. 用户点击桌宠
2. 打开聊天面板
3. 用户输入问题
4. Renderer 通过 preload API 调主进程
5. 主进程调用智谱 API
6. 返回结果给前端展示

### 文件分析流程

1. 用户拖入文件
2. 主进程读取文件并根据类型解析
3. 输出文本内容
4. 将文本送入模型总结
5. 结果回到聊天面板

### 提醒流程

1. 用户创建提醒
2. 主进程写入 SQLite
3. 调度器注册任务
4. 到点触发系统通知
5. 用户可标记完成或稍后提醒

## MVP 数据表建议

### conversations

- `id`
- `title`
- `created_at`
- `updated_at`

### messages

- `id`
- `conversation_id`
- `role`
- `content`
- `created_at`

### documents

- `id`
- `name`
- `type`
- `path`
- `extracted_text`
- `created_at`

### todos

- `id`
- `title`
- `description`
- `due_at`
- `status`
- `created_at`
- `updated_at`

## 安全与成本控制

- API Key 放在本地 `.env`
- 模型调用默认使用成本更低的模型
- 长文档先截断或分段总结，避免一次性传太长
- 会话上下文做长度控制，防止 token 费用失控

## MVP 不急着做的内容

- 语音输入输出
- 多模型切换
- 云端同步
- 桌宠复杂动作系统
- OCR 图片识别
- 多文档知识库

这些可以等第一版跑通之后再逐步增强。
