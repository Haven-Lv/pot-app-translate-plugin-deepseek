# pot-app-translate-plugin-openai-compatible

[pot-desktop](https://github.com/pot-app/pot-desktop) 通用 **OpenAI 兼容** AI 翻译插件。

只需填写 **服务地址 (API URL)** 和 **API 密钥**,即可接入任何提供 OpenAI Chat Completions 兼容接口的服务,例如:

| 服务 | 服务地址填写示例 |
| --- | --- |
| DeepSeek | `https://api.deepseek.com` |
| OpenAI | `https://api.openai.com/v1` |
| Moonshot Kimi | `https://api.moonshot.cn/v1` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` |
| 阿里 DashScope(兼容模式) | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| SiliconFlow 硅基流动 | `https://api.siliconflow.cn/v1` |
| Ollama(本地) | `http://127.0.0.1:11434/v1` |
| LM Studio(本地) | `http://127.0.0.1:1234/v1` |
| one-api / new-api 中转 | `https://你的中转地址/v1` |
| Gemini(OpenAI 兼容层) | `https://generativelanguage.googleapis.com/v1beta/openai` |

> 由 [pot-app-translate-plugin-deepseek](https://github.com/Tzulao55/pot-app-translate-plugin-deepseek) 改造而来。

## 功能特性

- **通用接入**:自动识别各种地址写法——只填域名自动补 `/v1/chat/completions`;填到 `/v1` 自动补 `/chat/completions`;粘贴完整 `.../chat/completions` 地址则原样使用
- **模型自动发现**:「模型」一栏留空或填 `?`,随便翻译一句话,插件会调用 `/models` 接口把该服务所有可用模型列在翻译框里,复制其中一个填回配置即可
- **流式输出**:默认开启,逐字显示翻译;推理模型思考阶段会显示 `💭 思考中(N 字)` 进度,正文开始后逐字输出
- **完整语言支持**:覆盖 pot 全部 32 种语言,包括粤语、挪威语、希伯来语等
- **推理模型友好**:默认不发送 `temperature` 等采样参数,兼容 DeepSeek-Reasoner、o1 等限制采样参数的模型;可通过「额外请求参数」自定义
- **额外请求参数**:可选 JSON 配置,支持 `reasoning_effort`、采样参数等透传,`model`/`messages`/`stream` 始终由插件控制不会被覆盖

## 安装

### 方式一:下载打包好的插件

1. 到本仓库 [Releases](../../releases) 页面(或 Actions 构建产物)下载 `plugin.com.generic.openai_compatible.potext`
2. 打开 pot → `设置` → `服务设置` → `翻译服务` → `添加插件`,选择本地安装,选中下载的 `.potext` 文件
3. 在服务列表中添加「OpenAI 兼容服务」,填好配置即可

### 方式二:远程地址安装

如果仓库已发布 Release,也可以在 pot 的添加插件界面直接填入 `.potext` 文件的下载 URL。

## 配置说明

| 配置项 | 说明 |
| --- | --- |
| 服务地址 (API URL) | 服务商的 API 地址,支持域名、带 `/v1` 的地址或完整接口地址,详见上表 |
| API 密钥 (API Key) | `sk-` 开头的密钥;本地服务(Ollama、LM Studio)可留空 |
| 模型 | 模型名。**留空或填 `?`** 后随便翻译一句,可用模型列表会显示在翻译结果里;或直接手动填写已知模型名,如 `deepseek-chat` |
| 额外请求参数 (JSON, 可选) | 透传给接口的额外字段。翻译场景最常用的是 `{"reasoning_effort":"low"}`——让推理模型少思考、直接翻译,实测能把响应时间缩短一半以上;也支持 `{"temperature":0.1}` 等采样参数 |
| 流式输出 | 默认开启;服务端不支持跨域流式时自动回退到非流式并提示,一般无需关闭 |

> **流式输出的限制**:pot 网页环境里的流式请求要求服务端返回跨域(CORS)响应头。OpenAI、DeepSeek 等官方接口支持;部分本地网关/代理(如 magpie)不返回 CORS 头,插件会自动降级为非流式请求并显示「⏳ 正在等待完整回复」提示——这是插件体系下能做到的最优行为,不是故障。若你的网关可配置 CORS(允许 `https://tauri.localhost` 来源),开启后即可恢复流式。

### 首次使用建议流程

1. 填好「服务地址」和「API 密钥」,「模型」先留空
2. 随便输入一句话翻译,结果框会显示检测到的模型列表
3. 复制想要的模型名(如 `deepseek-chat`),粘贴到配置的「模型」一栏,保存
4. 之后正常划词翻译即可

## 已知限制

- 插件配置面板由 pot 主程序渲染,仅支持文本输入和固定下拉选项,因此模型列表展示在翻译结果框中,需要手动复制一次模型名
- Azure OpenAI 的地址格式(`/openai/deployments/...`)请直接粘贴完整 `chat/completions` 地址,但注意其鉴权头为 `api-key`,本插件默认发送 `Authorization: Bearer`,以中转服务使用为宜

## 从源码打包

`main.js`、`info.json`、`icon.svg` 三个文件压缩为 zip 后重命名为 `plugin.com.generic.openai_compatible.potext` 即可(推送代码后 GitHub Actions 会自动打包)。

本地运行测试:

```bash
node test/smoke.js
```

> 注意:pot 通过 `eval(main.js + " translate")` 加载插件,`translate` 函数声明必须保持在 `main.js` 文件末尾。

## License

[GPL-3.0](./LICENSE)
