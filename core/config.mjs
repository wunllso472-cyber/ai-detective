import path from 'node:path';

// 所有配置都从环境变量读取：Next.js 会自动加载 .env.local，CLI 由 cli/detective.mjs 手动加载
export function getConfig() {
  const env = process.env;
  return {
    tencent: {
      secretId: env.TENCENTCLOUD_SECRET_ID || '',
      secretKey: env.TENCENTCLOUD_SECRET_KEY || '',
      endpoint: env.WSA_ENDPOINT || 'wsa.tencentcloudapi.com',
    },
    ark: {
      apiKey: env.ARK_API_KEY || '',
      baseUrl: (env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, ''),
      model: env.ARK_MODEL || 'doubao-seed-2-1-pro-260915',
      visionModel: env.ARK_VISION_MODEL || env.ARK_MODEL || 'doubao-seed-2-1-pro-260915',
    },
    search: {
      concurrency: Number(env.SEARCH_CONCURRENCY || 3),
      cacheMinutes: Number(env.SEARCH_CACHE_MINUTES || 30),
    },
    watch: {
      tickSeconds: Number(env.WATCH_TICK_SECONDS || 60),
      defaultIntervalMinutes: Number(env.WATCH_INTERVAL_MINUTES || 60),
    },
    dataDir: env.DATA_DIR || path.join(process.cwd(), 'data'),
  };
}

export function isSearchMock() {
  const c = getConfig();
  return process.env.MOCK_SEARCH === '1' || !c.tencent.secretId || !c.tencent.secretKey;
}

export function isLlmMock() {
  return process.env.MOCK_LLM === '1' || !getConfig().ark.apiKey;
}

export function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
