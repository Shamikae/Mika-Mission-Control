import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const FRONTMATTER_RE = /^---[\s\S]*?---\n?/;

function strip(md) {
  return typeof md === 'string' ? md.replace(FRONTMATTER_RE, '').trimStart() : '';
}

// Headings
function H1({ children }) { return <h1 className="md-h1">{children}</h1>; }
function H2({ children }) { return <h2 className="md-h2">{children}</h2>; }
function H3({ children }) { return <h3 className="md-h3">{children}</h3>; }

// Safe external links — no raw HTML, no target=_self override
function SafeLink({ href, children }) {
  const safe = href && !href.startsWith('javascript:');
  return safe
    ? <a href={href} target="_blank" rel="noreferrer noopener" className="md-link">{children}</a>
    : <span className="md-link-dead">{children}</span>;
}

// Code blocks — inline vs block
function Code({ inline, children, className }) {
  return inline
    ? <code className="md-inline-code">{children}</code>
    : (
      <pre className="md-code-block">
        <code className={className}>{children}</code>
      </pre>
    );
}

// Unwrap <pre> so Code handles it fully
function Pre({ children }) { return <>{children}</>; }

function BlockQuote({ children }) {
  return <blockquote className="md-blockquote">{children}</blockquote>;
}

function Table({ children })    { return <div className="md-table-wrap"><table className="md-table">{children}</table></div>; }
function Th({ children })       { return <th className="md-th">{children}</th>; }
function Td({ children })       { return <td className="md-td">{children}</td>; }

const COMPONENTS = {
  h1: H1, h2: H2, h3: H3,
  a: SafeLink,
  code: Code, pre: Pre,
  blockquote: BlockQuote,
  table: Table, th: Th, td: Td,
};

export default function MarkdownViewer({ content = '', className = '' }) {
  const cleaned = strip(content);
  if (!cleaned) return null;

  return (
    <div className={`markdown-viewer ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}