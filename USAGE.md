# 简单麦 Easy Eat · 使用说明

> **吃饭很重要，选饭可以很简单。**  
> 不填表、不比价、不纠结；像饭搭子聊两句，只给你一份刚好合现在状态的麦当劳套餐。

## 一、你需要准备什么

简单麦运行在 **WorkBuddy** 里，通过麦当劳 MCP 查门店/菜单/价格，通过 JEV 做最后判断。

| 前置条件 | 说明 |
|---|---|
| **WorkBuddy** | 已安装并登录；Windows |
| **麦当劳 MCP Token** | 打开 <https://open.mcd.cn/mcp>，手机号登录 → 控制台 → 激活 → 复制 Token，在 WorkBuddy 的 MCP 配置里启用 `mcd-mcp` |
| **JEV Key** | 打开 <https://jevmodel.org/zh/dashboard/>，登录后创建/显示 Key，保存到 `%USERPROFILE%\.jevmodel\api_key.txt` |
| **JEV 可用出口** | JEV 在大陆直连会被拒；需要可用代理（默认 `http://127.0.0.1:7897`，可用 `JEV_PROXY` 修改） |

> **JEV 是必需裁判。** 没有 JEV，简单麦不会给推荐，也不会用规则打分顶替。

## 二、安装

1. 从 GitHub 下载仓库 ZIP：

```text
https://github.com/MEI-tao888/mcd-dining-skill
```

2. 解压后，双击：

```text
install-easy-eat.cmd
```

3. 安装器会：

- 找到 WorkBuddy 和它自带的 Node；
- 检查 MCP Token、JEV Key；
- 复制程序到 `%LOCALAPPDATA%\EasyEat\app`；
- 复制 Skill 到 `%USERPROFILE%\.workbuddy\skills\easy-eat`；
- 跑一次 JEV health；
- 通过后启动小简、打开 WorkBuddy。

4. 如果失败，结果写在：

```text
%LOCALAPPDATA%\EasyEat\install-result.json
```

## 三、第一次使用

### 1. 小简的新手教程

第一次启动小简，会出现三步教程：

1. 「去领 MCP」→ 打开麦当劳 MCP 页面；
2. 「去注册 JEV」→ 打开 JEV 页面；
3. 「我配好了，检查一下」。

两项都配好后，小简会出现成功动效，并显示「开始点餐」。  
也可以点「跳过教程」，之后在右键菜单里选择「新手教程」重播。

### 2. 在 WorkBuddy 里打开

- 新建任务；
- 选择 `easy-eat` 技能；
- 如果 WorkBuddy 要求选择项目，选择：

```text
%LOCALAPPDATA%\EasyEat\app
```

### 3. 开始点餐

直接说：

```text
午饭吃啥
```

简单麦会先接一句，再问一个真正影响选择的问题。  
你回答后，它只给一份，带门店、套餐、价格、官方图和一句理由。  
不合适就说：

```text
换
```

它会换另一组；只换一次，第二次会给“改预算 / 改口味”的出口。

## 四、使用示例

> **你**：今天好累，想吃口热的。  
> **小简**：累了就先歇着，吃的我来定。有没有不能碰的（过敏那种）？  
> **你**：没有。  
> **小简**：楼下那家，精选单人餐三件套，¥34.50——主食小食饮料一次齐，热乎的。不合适你说换。

价格与门店以 `calculate-price` 的实时返回为准；菜单会随时段变化。

## 五、常见问题

### 1. 提示“没有找到 MCP Token”

先在 <https://open.mcd.cn/mcp> 申请 Token，并确认 WorkBuddy 的 `mcd-mcp` 连接器已启用。

### 2. 提示“JEV health 不通过”

依次检查：

- `%USERPROFILE%\.jevmodel\api_key.txt` 是否存在且非空；
- 本机代理是否可用（默认 `127.0.0.1:7897`）；
- 重新运行 `install-easy-eat.cmd`。

### 3. 小简没有出现

- 重新双击 `%LOCALAPPDATA%\EasyEat\app\pet\start-pet.cmd`；
- 检查任务管理器里有没有 `powershell.exe`；
- 如果教程没有出现，删除 `%LOCALAPPDATA%\EasyEat\onboarding.json` 后重试。

### 4. 图片/套餐和当前菜单不一致

简单麦只使用当前 MCP 返回的菜单与算价。  
如果 detail 查不到商品，它不会用旧数据继续推荐；换一组或稍后重试。

## 六、边界

- 只做推荐，不静默下单、不领券、不取消；
- 不摊菜单、不做 A/B/C、不做比价；
- 券只让已选中的那一份更值，不为用券换类型；
- 过敏信息只存本机，可清空；不发送给 JEV；
- 过敏只按菜名/选项名做关键词核对，不构成配料与交叉接触的安全保证；
- 购买链接不在 MCP 能力内，本版本不提供。

## 七、相关链接

- GitHub 仓库：<https://github.com/MEI-tao888/mcd-dining-skill>
- 麦当劳 MCP：<https://open.mcd.cn/mcp>
- JEV：<https://jevmodel.org/zh/dashboard/>
- 麦当劳大赛报名 Issue：<https://github.com/M-China/mcd-developer-innovation-challenge/issues/1360>
