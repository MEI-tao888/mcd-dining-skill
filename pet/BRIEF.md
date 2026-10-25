# 简单麦桌面宠物 · BRIEF

> 可选入口，不替代 WorkBuddy Skill。  
> 只允许改 `meal-skill/pet/**`；不要改 `skills/`、`scripts/`、`data/`、`docs/` 或根目录文档。

## 1. 目标

做一个 Windows 桌面悬浮小宠物，让用户到饭点时一眼看到“简单麦”，点一下就能进入 WorkBuddy 里的简单麦对话。

**它只做入口，不做第二套聊天：**

```text
宠物点击
  → 复制启动语到剪贴板
  → 打开 WorkBuddy
  → 用户 Ctrl+V，开始和简单麦对话
```

不调用 MCP、不调用模型、不存 Token/地址/电话。

## 2. 视觉

- 原创形象，暂名 **“小简”**：一份有表情的薯条/小汉堡角色，圆润、友好、厚描边。
- 配色：麦当劳式 **红 + 黄 + 奶油白**，但**不使用**麦当劳官方 Logo、Ronald、Grimace、Hamburglar、Birdie 等官方角色。
- 透明背景 PNG，512×512；同时保留可编辑 SVG。
- 风格关键词：diner、retro、rounded、thick outline、friendly、small mascot。
- 不要文字水印，不要复杂渐变，确保 180×220 悬浮窗里看得清。

## 3. 交互

- 窗口约 180×220，透明、无边框、置顶、可拖动、不占任务栏。
- 形象下方一个气泡：`今天吃啥？`
- 左键点击：
  1. 把启动语写入剪贴板；
  2. 打开 WorkBuddy；
  3. 短暂提示：`已复制，去 WorkBuddy 按 Ctrl+V`。
- 右键菜单：
  - 打开 WorkBuddy
  - 复制启动语
  - 打开项目目录
  - 退出
- 启动语放 `config.example.json`，不写死。

## 4. 技术

- PowerShell 5.1 + WPF（Windows 自带），不要 Electron/Tauri。
- `start-pet.cmd` 用 `-ExecutionPolicy Bypass` 启动 `.ps1`。
- WorkBuddy 默认路径：
  `WorkBuddy 安装目录\WorkBuddy.exe`
- 项目默认路径：
  `<你的项目根目录>`（安装器会写入实际路径）
- 如果 WorkBuddy 已在运行，只激活窗口，不重复启动。

## 5. 交付文件

```text
pet/
├── BRIEF.md
├── simple-eat-pet.ps1
├── start-pet.cmd
├── config.example.json
├── README.md
└── assets/
    ├── simple-eat-pet.svg
    └── simple-eat-pet.png
```

## 6. 验收

- 双击 `start-pet.cmd` 出现透明小宠物；
- 可拖动，右键菜单可退出；
- 左键后剪贴板有启动语；
- WorkBuddy 能被打开/激活；
- 不报 PowerShell 执行策略错误；
- 不改 `pet/` 以外任何文件；
- 16:30 前跑通；跑不通就砍掉，不影响主线。
