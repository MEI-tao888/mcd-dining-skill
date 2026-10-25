# 安装简单麦 Easy Eat

> 这份安装器面向 Windows。  
> 它只复制文件、检查本机配置、启动 WorkBuddy；不上传 Token/Key，不修改系统设置。

## 一、安装前准备

需要：

1. **WorkBuddy** 已安装并登录；
2. **麦当劳 MCP Token**：
   - 打开 <https://open.mcd.cn/mcp>
   - 手机号登录 → 控制台 → 激活 → 同意协议 → 复制 Token
   - 在 WorkBuddy 的 MCP 配置里填好（或设置环境变量 `MCD_MCP_TOKEN`）
3. **JEV Key**：
   - 打开 <https://jevmodel.org/zh/dashboard/>
   - 登录后创建/显示 Key
   - 保存到：`%USERPROFILE%\.jevmodel\api_key.txt`
4. **JEV 可用的本地代理**（默认 `http://127.0.0.1:7897`）  
   JEV 在大陆直连会被 451 拒绝；没有可用出口时，安装器会停在 health 检查。

> JEV 是必需裁判。没有 JEV，简单麦不会给推荐。

## 二、安装

1. 从 GitHub 下载仓库 ZIP，解压；
2. 双击：

```text
install-easy-eat.cmd
```

3. 安装器会：

   - 找到 WorkBuddy；
   - 找到 WorkBuddy 自带 Node；
   - 检查 MCP Token；
   - 检查 JEV Key；
   - 把程序复制到 `%LOCALAPPDATA%\EasyEat\app`；
   - 把 Skill 复制到 `%USERPROFILE%\.workbuddy\skills\easy-eat`；
   - 设置 `EASY_EAT_HOME`；
   - 跑一次 `judge.mjs --health`；
   - 启动小简、打开 WorkBuddy。

4. 如果失败，看同目录/控制台提示，结果写在：

```text
%LOCALAPPDATA%\EasyEat\install-result.json
```

退出码：

| 码 | 含义 |
|---|---|
| 0 | 安装完成 |
| 10 | 没找到 WorkBuddy |
| 11 | 没找到 Node |
| 20 | 没找到 MCP Token |
| 30 | 没找到 JEV Key |
| 40 | 复制程序失败 |
| 50 | JEV health 不通过 |

## 三、安装后怎么用

1. 小简出现在桌面右下角；
2. 第一次打开会显示教程（如果当前版本已带教程）；
3. 在 WorkBuddy 新建任务，选择 `easy-eat` 技能；
4. 如果 WorkBuddy 要求选择项目，选择：

```text
%LOCALAPPDATA%\EasyEat\app
```

5. 输入：

```text
午饭吃啥
```

## 四、给 agent 的安装方式

agent 可以直接运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-easy-eat.ps1 -Yes
```

然后读取：

```text
%LOCALAPPDATA%\EasyEat\install-result.json
```

`ok=true` 表示 Skill、程序目录、MCP、JEV health 都通过。

## 五、边界

- 安装器不能替用户完成手机号登录、邮箱验证、JEV 注册；
- 安装器不能绕过 Windows SmartScreen；
- 没有 JEV 可用出口时不会假装安装成功；
- 购买链接不在 MCP 能力内，本版本不提供。
