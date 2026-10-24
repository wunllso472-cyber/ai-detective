import { getConfig, isLlmMock } from './config.mjs';

// 火山引擎方舟（Ark）OpenAI 兼容接口。所有调用都要求模型输出 JSON，并做容错解析。

export function llmStatus() {
  const c = getConfig().ark;
  return { mock: isLlmMock(), model: isLlmMock() ? 'mock' : c.model, visionModel: isLlmMock() ? 'mock' : c.visionModel };
}

function extractJson(text) {
  if (!text) throw new Error('模型返回为空');
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  try {
    return JSON.parse(t);
  } catch {
    const start = t.search(/[[{]/);
    const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
    if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
    throw new Error('模型返回的不是合法 JSON');
  }
}

async function callArk({ model, messages, temperature }) {
  const c = getConfig().ark;
  const body = { model, messages, temperature };
  // doubao-seed 系列默认开启深度思考，查证流程里关掉以提速；设 ARK_THINKING=enabled 可打开
  const thinking = process.env.ARK_THINKING ?? 'disabled';
  if (thinking) body.thinking = { type: thinking };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Number(process.env.ARK_TIMEOUT_MS || 120_000));
  try {
    const res = await fetch(`${c.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    // 部分模型不支持 thinking 参数：去掉后重试一次，并在本进程内不再携带
    if (res.status === 400 && body.thinking && /thinking/i.test(JSON.stringify(data))) {
      process.env.ARK_THINKING = '';
      return callArk({ model, messages, temperature });
    }
    if (!res.ok) throw new Error(`方舟模型调用失败（HTTP ${res.status}）：${data?.error?.message || JSON.stringify(data).slice(0, 300)}`);
    return data?.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 调用 LLM 并返回解析后的 JSON。
 * @param {{task:string, system:string, user:string, images?:string[], temperature?:number, mock:()=>any}} opts
 *   images 为 data URL 或 http URL，传入时使用视觉模型；mock 在未配置 ARK_API_KEY 时提供替代输出。
 */
export async function chatJSON({ task, system, user, images, temperature = 0.2, mock }) {
  if (isLlmMock()) return mock();
  const c = getConfig().ark;
  const content = images?.length
    ? [...images.map((url) => ({ type: 'image_url', image_url: { url } })), { type: 'text', text: user }]
    : user;
  const messages = [
    { role: 'system', content: `${system}\n\n只输出一个 JSON 对象，不要输出任何解释或 Markdown 代码块。` },
    { role: 'user', content },
  ];
  const model = images?.length ? c.visionModel : c.model;
  let text = await callArk({ model, messages, temperature });
  try {
    return extractJson(text);
  } catch {
    // 再给一次机会：把上次的输出交回去要求修正为纯 JSON
    messages.push({ role: 'assistant', content: text }, { role: 'user', content: '上面的输出不是合法 JSON，请只输出修正后的 JSON 对象。' });
    text = await callArk({ model, messages, temperature: 0 });
    try {
      return extractJson(text);
    } catch (e) {
      throw new Error(`[${task}] ${e.message}`);
    }
  }
}
