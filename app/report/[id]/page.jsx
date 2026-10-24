import { Marked } from 'marked';
import { loadDoc } from '../../../core/store.mjs';
import PrintButton from './PrintButton';

export const dynamic = 'force-dynamic';

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const reportMarked = new Marked({
  gfm: true,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    // 报告本身不含图片，标题里混入的图片语法只显示文字
    image({ text }) {
      return escapeHtml(text);
    },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      if (!/^https?:\/\//i.test(href || '')) return label;
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${label}</a>`;
    },
  },
});

export async function generateMetadata({ params }) {
  const { id } = await params;
  const r = loadDoc('reports', id);
  return { title: r ? `${r.title} · 福尔摩搜 AI侦探社` : '报告不存在' };
}

export default async function ReportPage({ params }) {
  const { id } = await params;
  const r = loadDoc('reports', id);
  if (!r) {
    return (
      <div className="wrap">
        <div className="error-box">✘ 报告不存在</div>
      </div>
    );
  }
  // 报告里的标题、摘要来自搜索结果和模型输出，属于不可信内容：原始 HTML 一律转义，链接只保留 http(s)
  const html = reportMarked.parse(r.markdown);
  return (
    <div className="wrap">
      <div className="report-bar">
        <a className="btn ghost" href="/" style={{ textDecoration: 'none' }}>
          ← 返回侦探社
        </a>
        <span className="row">
          <a className="btn ghost" href={`/r/${r.resultId}`} style={{ textDecoration: 'none' }}>
            查证详情
          </a>
          <a className="btn ghost" href={`/api/report/${r.id}`} style={{ textDecoration: 'none' }}>
            下载 Markdown
          </a>
          <PrintButton />
        </span>
      </div>
      <article className="report" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
