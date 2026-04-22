# AI Desktop Pet

一个面向 Windows 桌面的 AI 智能桌宠应用原型，目标是以较低成本快速实现以下能力：

- 屏幕角落常驻悬浮宠物
- 点击展开聊天面板
- 接入智谱 API 进行对话
- 分析 PDF、DOCX、TXT 等主流文件
- 支持提醒事项与待办管理

## 技术选型

- 桌面框架：Electron
- 前端界面：React + Vite + TypeScript
- 样式：CSS Variables + 原生 CSS
- 状态管理：Zustand
- 本地存储：better-sqlite3
- 文档解析：
  - PDF：pdf-parse
  - DOCX：mammoth
- 调度提醒：node-schedule
- 系统通知：Electron Notification API
- 大模型服务：智谱 API

## 为什么先这样选

- Electron 适合做悬浮窗、托盘、系统通知和文件访问
- React 方便快速做聊天面板和设置页
- SQLite 比 JSON 更适合后续做提醒、待办、会话记录
- 智谱 API 成本更友好，适合先做 MVP

## MVP 范围

第一阶段只做最核心闭环：

1. 桌宠悬浮窗常驻桌面
2. 点击后打开聊天面板
3. 能与智谱模型对话
4. 支持导入 PDF/DOCX/TXT 并总结问答
5. 支持新增提醒与待办，并在本地定时提醒

详细设计见：

- [docs/mvp-architecture.md](C:\Users\63211\Documents\New project\docs\mvp-architecture.md)
- [docs/roadmap.md](C:\Users\63211\Documents\New project\docs\roadmap.md)

## 项目结构

```text
.
├─ docs/
├─ electron/
│  ├─ main/
│  └─ preload/
├─ src/
│  ├─ components/
│  ├─ features/
│  ├─ pages/
│  ├─ services/
│  ├─ store/
│  └─ styles/
└─ package.json
```

## 下一步

建议按下面顺序开发：

1. 先实现悬浮窗和聊天面板 UI
2. 再接智谱 API
3. 然后接入文件解析
4. 最后加提醒与待办
