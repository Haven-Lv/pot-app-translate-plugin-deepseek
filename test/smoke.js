// 插件冒烟测试:完全复刻 pot 的加载与调用方式
// pot 源码 (src/utils/invoke_plugin.js): eval(`${script} ${pluginType}`),pluginType = "translate"
// 运行:node test/smoke.js

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const script = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8')

// —— 复刻 pot 的插件加载(在函数内 eval,与 invoke_plugin.js 行为一致)——
function invokePlugin() {
    return eval(`${script} translate`)
}
const translate = invokePlugin()
assert.strictEqual(typeof translate, 'function', 'main.js 末尾追加 " translate" 后必须求值为 translate 函数')

// —— 模拟环境 ——
function makeTauriFetch(handler) {
    const calls = []
    const impl = async (url, options) => {
        calls.push({ url, options })
        return handler(url, options, calls.length)
    }
    return { impl, calls }
}

function okChoice(content) {
    return { ok: true, status: 200, data: { choices: [{ message: { content } }] } }
}

function sseWindowFetch(chunks) {
    const encoder = new TextEncoder()
    let i = 0
    return async () => ({
        ok: true,
        status: 200,
        headers: { get: () => 'text/event-stream' },
        body: {
            getReader() {
                return {
                    async read() {
                        if (i < chunks.length) {
                            return { done: false, value: encoder.encode(chunks[i++]) }
                        }
                        return { done: true }
                    },
                    releaseLock() {},
                }
            },
        },
    })
}

const RESULT_TIMEOUT = '【未设置】'
async function run(config, { tauriHandler, windowFetch } = {}) {
    const fetch = makeTauriFetch(tauriHandler ?? (() => okChoice('默认回复')))
    const results = []
    const utils = { tauriFetch: fetch.impl }
    const prevWindow = globalThis.window
    if (windowFetch) {
        globalThis.window = { fetch: windowFetch }
    } else {
        delete globalThis.window
    }
    try {
        const value = await translate('hello world', 'auto', 'Simplified Chinese', {
            config,
            detect: 'en',
            setResult: (v) => results.push(v),
            utils,
        })
        return { value, results, calls: fetch.calls }
    } finally {
        if (prevWindow === undefined) {
            delete globalThis.window
        } else {
            globalThis.window = prevWindow
        }
    }
}

async function main() {
    // 1. URL 规范化:各写法推导出的对话/模型接口地址
    const urlCases = [
        ['api.deepseek.com', 'https://api.deepseek.com/v1/chat/completions', 'https://api.deepseek.com/v1/models'],
        ['https://api.deepseek.com', 'https://api.deepseek.com/v1/chat/completions', 'https://api.deepseek.com/v1/models'],
        ['https://api.moonshot.cn/v1', 'https://api.moonshot.cn/v1/chat/completions', 'https://api.moonshot.cn/v1/models'],
        ['http://127.0.0.1:11434/v1/', 'http://127.0.0.1:11434/v1/chat/completions', 'http://127.0.0.1:11434/v1/models'],
        ['https://api.openai.com/v1/chat/completions', 'https://api.openai.com/v1/chat/completions', 'https://api.openai.com/v1/models'],
        ['https://generativelanguage.googleapis.com/v1beta/openai', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', 'https://generativelanguage.googleapis.com/v1beta/openai/models'],
    ]
    for (const [input, expectedChat, expectedModels] of urlCases) {
        const { calls, value } = await run(
            { requestPath: input, apiKey: 'sk-test', model: 'm1', stream: 'false' },
            { tauriHandler: () => okChoice('ok') }
        )
        assert.strictEqual(calls[0].url, expectedChat, `对话地址推导错误:${input}`)
        assert.strictEqual(value, 'ok')
        await run(
            { requestPath: input, apiKey: 'sk-test', model: '?' },
            { tauriHandler: () => ({ ok: true, status: 200, data: { data: [{ id: 'm1' }] } }) }
        ).then(({ calls }) => assert.strictEqual(calls[0].url, expectedModels, `模型地址推导错误:${input}`))
    }
    console.log('✓ URL 规范化(6 种写法)')

    // 2. 模型列表:模型名为空 / ? / ？ / models 时触发,分类展示
    for (const model of ['', '?', '？', 'models']) {
        const { value, calls } = await run(
            { requestPath: 'https://api.deepseek.com', apiKey: 'sk-test', model },
            {
                tauriHandler: () => ({
                    ok: true,
                    status: 200,
                    data: { data: [{ id: 'deepseek-reasoner' }, { id: 'deepseek-chat' }, { id: 'text-embedding-v3' }, { id: 'deepseek-chat' }] },
                }),
            }
        )
        assert.ok(calls[0].options.method === 'GET', '获取模型列表应为 GET')
        assert.ok(value.includes('3 个可用模型'), '应提示模型总数')
        assert.ok(value.indexOf('对话模型') < value.indexOf('不推荐'), '对话模型应排在前面')
        assert.ok(value.includes('deepseek-chat') && value.includes('deepseek-reasoner'), '应包含对话模型')
        assert.ok(!value.split('【对话模型')[0].includes('text-embedding'), '嵌入模型不应出现在对话组')
    }
    console.log('✓ 模型列表(空 / ? / ？ / models 触发,去重排序分类)')

    // 2b. 带原生接口标注的网关(如 magpie):仅支持 /v1/messages 的模型应归入不推荐组
    {
        const { value } = await run(
            { requestPath: 'http://127.0.0.1:3425/v1', apiKey: 'magpie', model: '?' },
            {
                tauriHandler: () => ({
                    ok: true,
                    status: 200,
                    data: {
                        data: [
                            { id: 'siliconflow/zai-org/GLM-5.3-Flash', native_endpoints: ['/v1/chat/completions'] },
                            { id: 'zcode/GLM-5.3-Flash', native_endpoints: ['/v1/messages'] },
                            { id: 'workbuddy/glm-5.3', native_endpoints: ['/v1/chat/completions', '/v1/messages'] },
                        ],
                    },
                }),
            }
        )
        const chatPart = value.split('【不推荐')[0]
        assert.ok(chatPart.includes('siliconflow/zai-org/GLM-5.3-Flash') && chatPart.includes('workbuddy/glm-5.3'), '支持 chat/completions 的模型应在对话组')
        assert.ok(!chatPart.includes('zcode/GLM-5.3-Flash'), '仅支持 /v1/messages 的模型不应在对话组')
        assert.ok(value.includes('zcode/GLM-5.3-Flash'), '非 OpenAI 接口模型仍应展示在不推荐组')
    }
    console.log('✓ 模型列表(native_endpoints 接口标注识别)')

    // 3. 非流式翻译:请求体、鉴权头、引号剥离
    {
        const { value, calls } = await run(
            { requestPath: 'https://api.deepseek.com/v1', apiKey: ' sk-test ', model: 'deepseek-chat', stream: 'false' },
            { tauriHandler: () => okChoice('"你好,世界"') }
        )
        const { options } = calls[0]
        assert.strictEqual(options.headers.Authorization, 'Bearer sk-test', '密钥应去除首尾空格')
        assert.strictEqual(options.body.type, 'Json')
        assert.strictEqual(options.body.payload.model, 'deepseek-chat')
        assert.strictEqual(options.body.payload.messages.length, 2)
        assert.ok(options.body.payload.messages[1].content.includes('"""') && options.body.payload.messages[1].content.includes('hello world'))
        assert.strictEqual(value, '你好,世界', '应剥离首尾引号')
    }
    console.log('✓ 非流式翻译(请求体 / 鉴权 / 引号剥离)')

    // 4. 流式翻译:SSE 分片、跨块 JSON、思考进度占位、[DONE]
    {
        const { value, results } = await run(
            { requestPath: 'https://api.deepseek.com', apiKey: 'sk', model: 'deepseek-chat' },
            {
                windowFetch: sseWindowFetch([
                    'data: {"choices":[{"delta":{"reasoning_content":"先"}}]}\n\n',
                    'data: {"choices":[{"delta":{"reasoning_content":"想一想"}}]}\n\n',
                    'data: {"choices":[{"delta":{"content":"你"}}]}\ndata: {"choices":[{"del',
                    'ta":{"content":"好"}}]}\n\ndata: [DONE]\n\n',
                ]),
            }
        )
        assert.strictEqual(value, '你好')
        assert.ok(results[0].startsWith('💭'), '思考阶段应显示进度占位')
        assert.ok(results.includes('💭 思考中(4 字)…'), '思考进度应随分片累加')
        assert.ok(results[results.length - 1] === '你好_', '正文阶段应输出逐步结果')
    }
    console.log('✓ 流式翻译(SSE 分片拼接 / 思考进度占位)')

    // 5. 流式失败自动降级:window 不存在时回退 tauriFetch,并给出提示
    {
        const { value, results, calls } = await run(
            { requestPath: 'https://api.deepseek.com', apiKey: 'sk', model: 'deepseek-chat' },
            { tauriHandler: () => okChoice('降级结果') }
        )
        assert.strictEqual(value, '降级结果')
        assert.ok(results.some((r) => r.includes('不支持流式')), '降级时应提示正在等待完整回复')
        assert.strictEqual(calls[0].options.body.payload.messages.length, 2, '降级后应走非流式请求')
        assert.strictEqual(calls[0].options.body.payload.stream, false, '非流式请求应显式 stream:false')
    }
    console.log('✓ 流式不可用时自动降级非流式(带提示)')

    // 6. 服务端忽略 stream 返回完整 JSON
    {
        const jsonFetch = async () => ({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ choices: [{ message: { content: '整体返回' } }] }),
            body: {},
        })
        const { value } = await run(
            { requestPath: 'https://x.example/v1', apiKey: 'sk', model: 'm' },
            { windowFetch: jsonFetch }
        )
        assert.strictEqual(value, '整体返回')
    }
    console.log('✓ 服务端忽略 stream 时按完整 JSON 解析')

    // 7. 错误传播:HTTP 错误、业务错误、content 数组
    {
        await assert.rejects(
            run({ requestPath: 'https://x.example', apiKey: 'sk', model: 'm', stream: 'false' }, { tauriHandler: () => ({ ok: false, status: 401, data: { error: { message: 'bad key' } } }) }),
            (e) => String(e).includes('401')
        )
        await assert.rejects(
            run({ requestPath: 'https://x.example', apiKey: 'sk', model: 'm', stream: 'false' }, { tauriHandler: () => okChoice('') }),
            (e) => String(e).includes('没有翻译内容')
        )
        const arr = await run(
            { requestPath: 'https://x.example', apiKey: '', model: 'm', stream: 'false' },
            { tauriHandler: () => ({ ok: true, status: 200, data: { choices: [{ message: { content: [{ type: 'text', text: '分段' }, { type: 'text', text: '内容' }] } }] } }) }
        )
        assert.strictEqual(arr.value, '分段内容')
        assert.ok(!arr.calls[0].options.headers.Authorization, '空密钥时不应携带 Authorization')
        await assert.rejects(
            run({ requestPath: '', apiKey: 'sk', model: 'm' }),
            (e) => String(e).includes('服务地址')
        )
    }
    console.log('✓ 错误处理(401 / 空内容 / content 数组 / 未填地址)')

    // 8. 额外请求参数:JSON 合并、model/messages 不被覆盖、非法输入报错
    {
        const { value, calls } = await run(
            {
                requestPath: 'https://x.example/v1',
                apiKey: 'sk',
                model: 'glm',
                stream: 'false',
                requestArguments: '{"reasoning_effort":"low","model":"hacked","stream":true}',
            },
            { tauriHandler: () => okChoice('带参数') }
        )
        const payload = calls[0].options.body.payload
        assert.strictEqual(value, '带参数')
        assert.strictEqual(payload.reasoning_effort, 'low', '额外参数应随请求发送')
        assert.strictEqual(payload.model, 'glm', '额外参数不得覆盖 model')
        assert.strictEqual(payload.stream, false, 'stream 应以插件开关为准')
        await assert.rejects(
            run({ requestPath: 'https://x.example', apiKey: 'sk', model: 'm', stream: 'false', requestArguments: '{bad json' }),
            (e) => String(e).includes('额外请求参数')
        )
        await assert.rejects(
            run({ requestPath: 'https://x.example', apiKey: 'sk', model: 'm', stream: 'false', requestArguments: '["a"]' }),
            (e) => String(e).includes('JSON 对象')
        )
        // 流式路径同样合并额外参数
        const sse = await run(
            { requestPath: 'https://x.example/v1', apiKey: 'sk', model: 'glm', requestArguments: '{"reasoning_effort":"low"}' },
            { windowFetch: sseWindowFetch(['data: {"choices":[{"delta":{"content":"快"}}]}\n\n', 'data: [DONE]\n\n']) }
        )
        assert.strictEqual(sse.value, '快')
    }
    console.log('✓ 额外请求参数(JSON 合并 / 覆盖保护 / 非法输入)')

    // 9. 思考力度下拉:auto 不发送、low/high 发送、额外参数优先
    {
        const mk = (reasoning, extra) =>
            run(
                { requestPath: 'https://x.example/v1', apiKey: 'sk', model: 'm', stream: 'false', reasoning, requestArguments: extra },
                { tauriHandler: () => okChoice('ok') }
            ).then(({ calls }) => calls[0].options.body.payload)
        assert.strictEqual((await mk(undefined, undefined)).reasoning_effort, undefined, '未配置时应发送 reasoning_effort')
        assert.strictEqual((await mk('auto', undefined)).reasoning_effort, undefined, 'auto 不应发送 reasoning_effort')
        assert.strictEqual((await mk('low', undefined)).reasoning_effort, 'low')
        assert.strictEqual((await mk('high', undefined)).reasoning_effort, 'high')
        assert.strictEqual((await mk('low', '{"reasoning_effort":"max"}')).reasoning_effort, 'max', '额外参数中的取值应优先于下拉')
    }
    console.log('✓ 思考力度(auto 不发送 / low-high 发送 / 额外参数优先)')

    console.log('\n全部通过 🎉')
}

main().catch((e) => {
    console.error('测试失败:', e)
    process.exit(1)
})
