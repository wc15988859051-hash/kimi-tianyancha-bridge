/**
 * Kimi Tianyancha MCP Bridge - Vercel Edge Runtime 版
 * 将 Kimi 专业数据库（天眼查）封装为标准 MCP SSE 服务端点
 */

export const runtime = 'edge';

import { v4 as uuidv4 } from 'uuid';

// 全局存储（Vercel Edge Runtime 同区域内有效）
if (!global.connections) {
  global.connections = new Map();
}
const connections = global.connections;

if (!global.lastActivity) {
  global.lastActivity = new Map();
}
const lastActivity = global.lastActivity;

// MCP 工具定义
const TOOLS = [
    {
        name: 'tianyancha_api_search',
        description: '搜索天眼查可用的API接口，发现企业数据查询能力。使用关键词如"企业基本信息,股东信息"、"司法风险,年报"、"专利,招投标"等搜索',
        inputSchema: {
            type: 'object',
            properties: {
                query: { 
                    type: 'string', 
                    description: '查询关键词，如"企业基本信息,股东信息"、"司法风险,年报"、"专利,招投标"等，不允许使用公司名作为查询词'
                },
                limit: { 
                    type: 'string', 
                    default: '10',
                    description: '返回结果数量限制，默认10个，最大20个'
                }
            },
            required: ['query']
        }
    },
    {
        name: 'tianyancha_company_search',
        description: '搜索企业获得准确的公司全称和基本信息。仅在公司全称不确定时使用，已知全称请直接使用 tianyancha_api_call',
        inputSchema: {
            type: 'object',
            properties: {
                search_keyword: { 
                    type: 'string',
                    description: '搜索关键词，可以是公司简称、注册号、统一信用代码等'
                },
                page_size: { 
                    type: 'integer', 
                    default: 20,
                    description: '每页返回条数，默认20，最大20'
                },
                page_num: { 
                    type: 'integer', 
                    default: 1,
                    description: '当前页数，默认第1页'
                }
            },
            required: ['search_keyword']
        }
    },
    {
        name: 'tianyancha_api_call',
        description: '调用指定的天眼查API查询企业详细信息。必须使用完整的企业全称，不能使用简称（如用"北京百度网讯科技有限公司"而非"百度"）',
        inputSchema: {
            type: 'object',
            properties: {
                api_call_name: { 
                    type: 'string',
                    description: '要调用的API名称（从tianyancha_api_search结果中获取）'
                },
                api_call_params: {
                    type: 'object',
                    properties: {
                        keyword: { 
                            type: 'string',
                            description: '完整企业全称，如"北京月之暗面科技有限公司"。支持多公司用逗号分隔最多5个'
                        },
                        pageNum: { 
                            type: 'integer', 
                            default: 1,
                            description: '当前页数，默认1'
                        },
                        pageSize: { 
                            type: 'integer', 
                            default: 20,
                            description: '每页条数，默认20，最大20'
                        }
                    },
                    required: ['keyword']
                }
            },
            required: ['api_call_name', 'api_call_params']
        }
    }
];

export default async function handler(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    if (path === '/sse' || path === '/api/sse') {
        return handleSSE(request, corsHeaders);
    }

    if (path === '/messages' || path === '/api/messages') {
        return handleMessages(request, corsHeaders);
    }

    if (path === '/health' || path === '/api/health') {
        return new Response(
            JSON.stringify({ 
                status: 'ok', 
                connections: connections.size,
                environment: 'vercel-edge',
                note: 'Connections are ephemeral in Edge Runtime'
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    if (path === '/poll' || path === '/api/poll') {
        return handlePoll(request, corsHeaders);
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
}

async function handleSSE(request, corsHeaders) {
    const sessionId = uuidv4();
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        start(controller) {
            connections.set(sessionId, controller);
            lastActivity.set(sessionId, Date.now());

            const messageEndpoint = `/messages?sessionId=${sessionId}`;
            const endpointData = `event: endpoint\ndata: ${JSON.stringify({ 
                uri: messageEndpoint,
                sessionId: sessionId
            })}\n\n`;
            controller.enqueue(encoder.encode(endpointData));

            console.log(`[SSE] 连接建立: ${sessionId}, 当前连接数: ${connections.size}`);

            // 20秒心跳保活
            const heartbeat = setInterval(() => {
                try {
                    controller.enqueue(encoder.encode(':heartbeat\n\n'));
                    lastActivity.set(sessionId, Date.now());
                } catch {
                    clearInterval(heartbeat);
                    cleanup(sessionId);
                }
            }, 20000);

            const cleanup = (sid) => {
                clearInterval(heartbeat);
                connections.delete(sid);
                lastActivity.delete(sid);
                console.log(`[SSE] 连接清理: ${sid}`);
            };

            request.signal.addEventListener('abort', () => cleanup(sessionId));
            setTimeout(() => cleanup(sessionId), 300000); // 5分钟强制清理
        }
    });

    return new Response(stream, {
        headers: {
            ...corsHeaders,
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    });
}

async function handleMessages(request, corsHeaders) {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId');
    const controller = connections.get(sessionId);

    if (!controller) {
        return new Response(
            JSON.stringify({ 
                error: '连接不存在或已过期',
                code: 'CONNECTION_LOST',
                suggestion: '请重新建立 SSE 连接，或使用 /poll 端点',
                sessionId: sessionId
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    try {
        const message = await request.json();
        lastActivity.set(sessionId, Date.now());
        processMessage(controller, message, sessionId);

        return new Response(
            JSON.stringify({ status: 'accepted', sessionId }),
            { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    } catch (error) {
        return new Response(
            JSON.stringify({ error: '消息解析失败', detail: error.message }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
}

async function handlePoll(request, corsHeaders) {
    const url = new URL(request.url);
    const method = url.searchParams.get('method');
    const params = url.searchParams.get('params');

    if (!method) {
        return new Response(
            JSON.stringify({ 
                error: '缺少 method 参数',
                usage: '/poll?method=tools/list 或 /poll?method=tools/call&params=...'
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    try {
        let result;
        if (method === 'tools/list') {
            result = { tools: TOOLS };
        } else if (method === 'tools/call' && params) {
            const parsedParams = JSON.parse(decodeURIComponent(params));
            result = await executeToolCall(parsedParams);
        } else {
            result = { error: '未知方法或缺少参数' };
        }

        return new Response(
            JSON.stringify({ jsonrpc: '2.0', result, mode: 'short-polling' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    } catch (error) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
}

async function processMessage(controller, message, sessionId) {
    const encoder = new TextEncoder();

    if (message.jsonrpc !== '2.0') {
        sendError(controller, encoder, message.id, -32600, '无效的 JSON-RPC 请求');
        return;
    }

    try {
        switch (message.method) {
            case 'initialize':
                await handleInitialize(controller, encoder, message.id);
                break;
            case 'initialized':
                break;
            case 'tools/list':
                await handleToolsList(controller, encoder, message.id);
                break;
            case 'tools/call':
                await handleToolCall(controller, encoder, message.id, message.params, sessionId);
                break;
            default:
                sendError(controller, encoder, message.id, -32601, `未知方法: ${message.method}`);
        }
    } catch (error) {
        console.error('[Error]', error);
        sendError(controller, encoder, message.id, -32603, `内部错误: ${error.message}`);
    }
}

async function handleInitialize(controller, encoder, id) {
    const result = {
        protocolVersion: '2024-11-05',
        capabilities: { 
            tools: {},
            experimental: { shortPolling: '/poll' }
        },
        serverInfo: { 
            name: 'kimi-tianyancha-bridge', 
            version: '1.0.0',
            environment: 'vercel-edge'
        }
    };
    sendMessage(controller, encoder, id, result);
}

async function handleToolsList(controller, encoder, id) {
    sendMessage(controller, encoder, id, { tools: TOOLS });
}

async function handleToolCall(controller, encoder, id, params, sessionId) {
    const { name, arguments: args } = params;
    const KIMI_API_KEY = process.env.KIMI_API_KEY;

    if (!KIMI_API_KEY) {
        sendError(controller, encoder, id, -32603, '未配置 KIMI_API_KEY');
        return;
    }

    console.log(`[Tool] [${sessionId}] 调用 ${name}`, args);

    try {
        lastActivity.set(sessionId, Date.now());
        const result = await executeToolCall({ name, arguments: args }, KIMI_API_KEY);
        sendMessage(controller, encoder, id, result);
    } catch (error) {
        console.error('[Kimi API Error]', error);
        sendError(controller, encoder, id, -32603, `Kimi API 调用失败: ${error.message}`);
    }
}

async function executeToolCall(params, apiKey) {
    const { name, arguments: args } = params;
    const KIMI_API_KEY = apiKey || process.env.KIMI_API_KEY;

    const response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${KIMI_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'moonshot-v1-128k',
            messages: [
                {
                    role: 'system',
                    content: `执行天眼查工具: ${name}，参数: ${JSON.stringify(args)}`
                },
                {
                    role: 'user',
                    content: `请执行工具调用并返回结果`
                }
            ],
            tools: [{ type: 'builtin_function', function: { name: name } }],
            tool_choice: 'auto',
            temperature: 0.1
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Kimi API 错误: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    let result;
    if (choice?.message?.tool_calls) {
        result = {
            content: [{
                type: 'text',
                text: `工具调用结果:\n${JSON.stringify(choice.message.tool_calls[0], null, 2)}`
            }]
        };
    } else {
        result = {
            content: [{
                type: 'text',
                text: choice?.message?.content || '查询完成'
            }]
        };
    }

    return result;
}

function sendMessage(controller, encoder, id, result) {
    const message = { jsonrpc: '2.0', id, result };
    try {
        controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(message)}\n\n`));
    } catch (e) {
        console.error('[Send Error]', e);
    }
}

function sendError(controller, encoder, id, code, message) {
    const errorMsg = { jsonrpc: '2.0', id, error: { code, message } };
    try {
        controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(errorMsg)}\n\n`));
    } catch (e) {
        console.error('[Send Error]', e);
    }
}
