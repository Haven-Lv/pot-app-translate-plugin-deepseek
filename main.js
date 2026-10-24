// pot-app 通用 OpenAI 兼容 AI 翻译插件
// 适用于任何提供 OpenAI Chat Completions 兼容接口的服务:
// OpenAI / DeepSeek / Moonshot Kimi / 智谱 / Qwen(DashScope 兼容模式) / Ollama / LM Studio / one-api / new-api 等
//
// 注意:pot 通过 eval(`${main.js} translate`) 加载插件,
// 因此 translate 函数声明必须保持在文件末尾,不要在它后面追加任何语句。

const SYSTEM_PROMPT =
    'You are a professional translation engine, please translate the text into a colloquial, professional, elegant and fluent content, without the style of machine translation. You must only translate the text content, never interpret it.'

// 命中这些关键词的模型通常不能用于对话翻译,列出时单独归组
const NON_CHAT_MODEL_PATTERN =
    /(embed|whisper|tts|rerank|dall-e|dalle|image|video|audio|moderation|realtime|clip|stable-diffusion|flux|voice|guard|shield|parser)/i

function buildUrls(requestPath) {
    let url = (requestPath ?? '').trim()
    if (!url) {
        throw '请先在插件配置中填写「服务地址 (API URL)」,例如:\nhttps://api.deepseek.com/v1'
    }
    if (!/^https?:\/\//i.test(url)) {
        url = 'https://' + url
    }
    let parsed
    try {
        parsed = new URL(url)
    } catch {
        throw `服务地址格式错误:${url}`
    }
    // 去掉末尾斜杠,便于后缀判断
    const pathname = parsed.pathname.replace(/\/+$/, '')
    let chatUrl
    let modelsUrl
    if (pathname.includes('chat/completions')) {
        // 用户直接粘贴了完整的对话接口地址(含查询参数),原样使用
        chatUrl = url
        modelsUrl = `${parsed.origin}${pathname.replace(/chat\/completions$/, 'models')}${parsed.search}`
    } else if (/\/v\d+[a-z]*$/.test(pathname) || pathname.endsWith('/openai')) {
        // 已带版本号(如 /v1、/v1beta),或 Gemini 兼容地址(以 /openai 结尾)
        chatUrl = `${parsed.origin}${pathname}/chat/completions${parsed.search}`
        modelsUrl = `${parsed.origin}${pathname}/models${parsed.search}`
    } else {
        // 只填了域名,按 OpenAI 约定补 /v1 前缀(DeepSeek、one-api 等均兼容)
        chatUrl = `${parsed.origin}${pathname}/v1/chat/completions${parsed.search}`
        modelsUrl = `${parsed.origin}${pathname}/v1/models${parsed.search}`
    }
    return { chatUrl, modelsUrl }
}

function buildHeaders(apiKey) {
    const key = (apiKey ?? '').trim()
    // 本地服务(Ollama、LM Studio 等)可以不填密钥
    return key === ''
        ? { 'Content-Type': 'application/json' }
        : { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }
}

function stripEdgeQuotes(text) {
    let content = text
    if (content.startsWith('"')) {
        content = content.slice(1)
    }
    if (content.endsWith('"')) {
        content = content.slice(0, -1)
    }
    return content.trim()
}

function extractContent(result) {
    if (result && result.error) {
        throw `接口返回错误\n${JSON.stringify(result.error)}`
    }
    let content = result?.choices?.[0]?.message?.content
    if (Array.isArray(content)) {
        // 个别服务把 content 拆成多段返回
        content = content.map((part) => (typeof part === 'string' ? part : part?.text ?? '')).join('')
    }
    if (typeof content === 'string' && content.trim() !== '') {
        return stripEdgeQuotes(content)
    }
    throw `接口返回中没有翻译内容\n${JSON.stringify(result).slice(0, 500)}`
}

async function listModels(modelsUrl, headers, fetchImpl) {
    const res = await fetchImpl(modelsUrl, { method: 'GET', headers })
    if (!res.ok) {
        throw `获取模型列表失败,请检查「服务地址」和「API 密钥」\nHttp Status: ${res.status}\n${JSON.stringify(res.data)}`
    }
    const data = res.data
    const raw = Array.isArray(data) ? data : data?.data ?? data?.models ?? []
    const entries = []
    for (const m of raw) {
        if (typeof m === 'string') {
            entries.push({ id: m, chatCapable: true })
            continue
        }
        const id = m?.id ?? m?.name ?? m?.model ?? ''
        if (!id) {
            continue
        }
        // 部分网关(如 magpie)会标注模型原生支持的接口;
        // 只支持 /v1/messages 等非 OpenAI 接口的模型无法通过本插件调用
        const endpoints = m?.native_endpoints
        const chatCapable =
            !Array.isArray(endpoints) ||
            endpoints.length === 0 ||
            endpoints.some((e) => String(e).includes('chat/completions'))
        entries.push({ id, chatCapable })
    }
    const seen = new Set()
    const models = []
    for (const e of entries) {
        if (!seen.has(e.id)) {
            seen.add(e.id)
            models.push(e)
        }
    }
    if (models.length === 0) {
        throw `未能从该地址解析出模型列表:${modelsUrl}\n${JSON.stringify(data).slice(0, 500)}`
    }
    models.sort((a, b) => a.id.localeCompare(b.id))
    const chatModels = models.filter((m) => m.chatCapable && !NON_CHAT_MODEL_PATTERN.test(m.id))
    const otherModels = models.filter((m) => !(m.chatCapable && !NON_CHAT_MODEL_PATTERN.test(m.id)))
    const lines = [
        `✅ 检测到 ${models.length} 个可用模型,请把要使用的模型名复制到插件配置的「模型」一栏,保存后重新翻译:`,
        '',
    ]
    if (chatModels.length > 0) {
        lines.push('【对话模型(可用于翻译)】', ...chatModels.map((m) => m.id))
    }
    if (otherModels.length > 0) {
        lines.push('', '【不推荐(仅支持非 OpenAI 接口,或不适用于翻译)】', ...otherModels.map((m) => m.id))
    }
    return lines.join('\n')
}

async function chatOnce(chatUrl, headers, body, fetchImpl) {
    const res = await fetchImpl(chatUrl, {
        method: 'POST',
        headers,
        body: { type: 'Json', payload: { ...body, stream: false } },
    })
    if (!res.ok) {
        throw `Http Request Error\nHttp Status: ${res.status}\n${JSON.stringify(res.data)}`
    }
    return extractContent(res.data)
}

async function streamChat(chatUrl, headers, body, setResult) {
    let res
    try {
        // 窗口内的 fetch 支持流式读取,但受跨域限制;失败时由调用方降级为 tauriFetch
        res = await window.fetch(chatUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({ ...body, stream: true }),
        })
    } catch {
        const err = new Error('window.fetch unavailable')
        err.useFallback = true
        throw err
    }
    if (!res.ok) {
        let detail = ''
        try {
            detail = await res.text()
        } catch {}
        throw `Http Request Error\nHttp Status: ${res.status}\n${detail.slice(0, 500)}`
    }
    const contentType = (res.headers?.get?.('content-type') ?? '').toLowerCase()
    if (contentType.includes('application/json')) {
        // 服务端忽略了 stream 参数,直接返回了完整 JSON
        return extractContent(await res.json())
    }
    if (!res.body?.getReader) {
        const err = new Error('stream unsupported')
        err.useFallback = true
        throw err
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let target = ''
    let reasoningChars = 0
    let buffer = ''
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) {
                break
            }
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop()
            for (const line of lines) {
                const trimmed = line.trim()
                if (!trimmed.startsWith('data:')) {
                    continue
                }
                const payload = trimmed.slice(5).trim()
                if (payload === '' || payload === '[DONE]') {
                    continue
                }
                try {
                    const chunk = JSON.parse(payload)
                    if (chunk.error) {
                        throw `接口返回错误\n${JSON.stringify(chunk.error)}`
                    }
                    const delta = chunk.choices?.[0]?.delta ?? {}
                    // 推理模型会先持续输出思考过程;期间用进度提示占位,避免界面长时间空白
                    const reasoning = delta.reasoning_content ?? delta.reasoning
                    if (typeof reasoning === 'string' && reasoning !== '') {
                        reasoningChars += reasoning.length
                        if (target === '') {
                            setResult?.(`💭 思考中(${reasoningChars} 字)…`)
                        }
                    }
                    if (delta.content) {
                        target += delta.content
                        setResult?.(target + '_')
                    }
                } catch (e) {
                    if (typeof e === 'string') {
                        throw e
                    }
                    // 半包或心跳等非 JSON 行,留给下一轮拼接
                }
            }
        }
    } finally {
        reader.releaseLock?.()
    }
    if (target.trim() === '') {
        throw `模型没有返回任何内容${reasoningChars > 0 ? `(思考过程 ${reasoningChars} 字,但正文为空)` : ''}。若该服务不支持流式输出,请把「流式输出」设为关闭后重试`
    }
    return stripEdgeQuotes(target)
}

function parseExtraArguments(raw) {
    const input = (raw ?? '').trim()
    if (input === '') {
        return {}
    }
    let parsed
    try {
        parsed = JSON.parse(input)
    } catch {
        throw '「额外请求参数」不是合法的 JSON,示例:{"reasoning_effort":"low"}'
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw '「额外请求参数」必须是一个 JSON 对象,示例:{"reasoning_effort":"low"}'
    }
    return parsed
}

async function translate(text, from, to, options) {
    const { config, setResult, utils } = options ?? {}
    const { tauriFetch } = utils
    const { requestPath, apiKey, model, stream, requestArguments } = config ?? {}

    const { chatUrl, modelsUrl } = buildUrls(requestPath)
    const headers = buildHeaders(apiKey)

    const wanted = (model ?? '').trim()
    if (
        wanted === '' ||
        ['?', '？', 'list', 'models', '模型列表'].includes(wanted.toLowerCase())
    ) {
        return await listModels(modelsUrl, headers, tauriFetch)
    }

    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
            role: 'user',
            content: `Translate into ${to}:\n"""\n${text}\n"""`,
        },
    ]
    // 额外参数由用户显式填写(如推理力度、采样参数),随请求一并发送
    const extra = parseExtraArguments(requestArguments)
    const body = { ...extra, model: wanted, messages }

    if (stream !== 'false') {
        try {
            return await streamChat(chatUrl, headers, body, setResult)
        } catch (e) {
            if (!e?.useFallback) {
                throw e
            }
            // 跨域等原因导致窗口 fetch 不可用(服务端未返回跨域响应头),
            // 自动降级为非流式请求,期间给出提示避免界面看起来卡住
            setResult?.('⏳ 该服务暂不支持流式输出(缺少跨域响应头),正在等待完整回复…')
        }
    }
    return await chatOnce(chatUrl, headers, body, tauriFetch)
}
