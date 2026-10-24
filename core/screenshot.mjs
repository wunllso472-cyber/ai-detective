import { chatJSON } from './llm.mjs';
import { verify, saveResult } from './case.mjs';
import { normText, parseDate } from './sources.mjs';

// 截图查证：视觉模型读图 → 提取可核查主张和元信息 → 走基础查证 → 截图与来源一致性检查。

const noop = () => {};

function parseLooseDate(s) {
  if (!s) return null;
  const full = parseDate(s);
  if (full) return full;
  const m = String(s).match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (!m) return null;
  const now = new Date();
  const d = new Date(now.getFullYear(), +m[1] - 1, +m[2]);
  if (d > now) d.setFullYear(d.getFullYear() - 1);
  return d;
}

async function readImage(imageDataUrl) {
  return chatJSON({
    task: 'vision',
    images: [imageDataUrl],
    system:
      '你是事实核查员，正在审阅一张网传截图。先如实转写图中文字，再提炼出截图想让人相信的核心说法，并记录图中可见的元信息。' +
      '只描述图中实际可见的内容，看不清的写空字符串，不要猜测。',
    user:
      '输出格式：{"ocr_text":"图中主要文字（可节选，不超过 500 字）","image_type":"新闻截图/社交媒体帖子/聊天记录/公告通知/其他",' +
      '"platform":"图中可辨认的平台，如微信公众号/微博/抖音/某新闻 App，无法辨认则空","publisher":"发布者或账号名，无则空",' +
      '"publish_time":"图中显示的发布时间，原样抄写，无则空","core_claim":"截图传达的核心说法，改写成一句可核查的陈述句",' +
      '"key_details":["关键细节：数字、地点、人物、机构等，最多 5 条"],"visual_flags":["肉眼可见的可疑之处，如字体/排版不一致、拼接痕迹、水印异常、官方格式不符；没有就给空数组"]}',
    mock: () => ({
      ocr_text: '【模拟】这是模拟识别出的截图文字：某市将于下月起全面取消燃油车上牌。',
      image_type: '社交媒体帖子',
      platform: '微博',
      publisher: '某某观察',
      publish_time: '10月20日 09:12',
      core_claim: '某市将于下月起全面取消燃油车上牌',
      key_details: ['下月起', '全面取消', '燃油车上牌'],
      visual_flags: [],
    }),
  });
}

function consistencyCheck(result, extracted) {
  const publisher = String(extracted.publisher || '').trim();
  const claimedDate = parseLooseDate(extracted.publish_time);
  const evidence = result.claims.flatMap((cl) => [...cl.support, ...cl.refute].map((e) => ({ ...e, stance: cl.support.includes(e) ? 'support' : 'refute' })));
  const src = Object.fromEntries(result.sources.map((s) => [s.id, s]));
  const pubNorm = normText(publisher);
  const publisherHits = publisher
    ? result.sources.filter((s) => pubNorm.length >= 2 && normText(`${s.site} ${s.title} ${s.passage}`).includes(pubNorm)).map((s) => s.id)
    : [];
  let dateHits = [];
  if (claimedDate) {
    dateHits = evidence
      .map((e) => src[e.sourceId])
      .filter((s) => s.dateISO && Math.abs(new Date(s.dateISO) - claimedDate) <= 3 * 86400_000)
      .map((s) => s.id);
  }
  const notes = [];
  if (publisher) {
    notes.push(
      publisherHits.length
        ? `搜索结果中能找到与发布者「${publisher}」相关的内容（${publisherHits.slice(0, 3).join('、')}）。`
        : `没有在搜索结果中找到发布者「${publisher}」的相关原文，截图出处无法证实。`,
    );
  }
  if (claimedDate) {
    notes.push(
      dateHits.length
        ? `截图时间（${extracted.publish_time}）前后 3 天内有相关报道（${[...new Set(dateHits)].slice(0, 3).join('、')}）。`
        : `截图时间（${extracted.publish_time}）前后 3 天内没有找到相关报道，可能是旧闻翻炒或时间被改动。`,
    );
  }
  const officialClaimed = /政府|官方|公安|通报|公告|卫健委|教育局|发布/.test(`${publisher} ${extracted.image_type} ${extracted.ocr_text}`);
  const officialFound = evidence.some((e) => src[e.sourceId].tier >= 5);
  if (officialClaimed && !officialFound) notes.push('截图看起来像官方发布，但没有检索到对应的官方原文，需警惕伪造或张冠李戴。');
  let level = 'ok';
  if ((publisher && !publisherHits.length) || (claimedDate && !dateHits.length) || (officialClaimed && !officialFound)) level = 'warn';
  if (result.verdict === 'false') level = 'bad';
  return { publisher, publisherHits, claimedDate: claimedDate?.toISOString() || null, dateHits: [...new Set(dateHits)], officialClaimed, officialFound, level, notes };
}

/**
 * @param {string} imageDataUrl data:image/...;base64,...
 */
export async function verifyScreenshot(imageDataUrl, { emit = noop, note = '' } = {}) {
  if (!/^data:image\/(png|jpe?g|webp|gif|bmp);base64,/.test(imageDataUrl || '')) throw new Error('请上传 png/jpg/webp 格式的截图');
  emit({ type: 'stage', stage: 'ocr', status: 'start', message: '视觉模型读取截图' });
  const ex = await readImage(imageDataUrl);
  const extracted = {
    ocrText: String(ex.ocr_text || '').slice(0, 1500),
    imageType: String(ex.image_type || ''),
    platform: String(ex.platform || ''),
    publisher: String(ex.publisher || ''),
    publishTime: String(ex.publish_time || ''),
    coreClaim: String(ex.core_claim || '').trim(),
    keyDetails: (Array.isArray(ex.key_details) ? ex.key_details : []).map(String).slice(0, 5),
    visualFlags: (Array.isArray(ex.visual_flags) ? ex.visual_flags : []).map(String).slice(0, 5),
  };
  if (!extracted.coreClaim) throw new Error('没能从截图中识别出可核查的说法，请换一张更清晰的截图');
  emit({ type: 'extracted', extracted });
  emit({ type: 'stage', stage: 'ocr', status: 'done', message: `识别到核心说法：${extracted.coreClaim}` });

  const context = [
    extracted.platform && `截图平台：${extracted.platform}`,
    extracted.publisher && `发布者：${extracted.publisher}`,
    extracted.publishTime && `图中时间：${extracted.publishTime}`,
    extracted.keyDetails.length && `关键细节：${extracted.keyDetails.join('、')}`,
    note && `用户备注：${note}`,
  ]
    .filter(Boolean)
    .join('；');
  // 额外一路：直接搜“发布者 + 说法”，核对截图出处
  const extraTasks = extracted.publisher
    ? [{ kind: 'publisher', query: `${extracted.publisher} ${extracted.coreClaim.slice(0, 18)}`, mode: 0, cnt: 10 }]
    : [];
  const result = await verify(extracted.coreClaim, { emit, context, extraTasks, kind: 'screenshot', save: false });
  result.screenshot = { extracted, consistency: consistencyCheck(result, extracted) };
  // 原图不大时一并保存，便于历史回看
  if (imageDataUrl.length < 2_500_000) result.screenshot.image = imageDataUrl;
  saveResult(result);
  return result;
}
