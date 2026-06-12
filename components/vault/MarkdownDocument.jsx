function inlineText(text) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);

  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={`${part}-${index}`}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

export default function MarkdownDocument({ content }) {
  const lines = String(content || '').split('\n');

  return (
    <article className="markdown-document">
      {lines.map((line, index) => {
        const key = `${index}-${line}`;
        if (!line.trim()) return <div className="markdown-spacer" key={key} aria-hidden="true" />;
        if (line.startsWith('# ')) return <h1 key={key}>{inlineText(line.slice(2))}</h1>;
        if (line.startsWith('## ')) return <h2 key={key}>{inlineText(line.slice(3))}</h2>;
        if (line.startsWith('### ')) return <h3 key={key}>{inlineText(line.slice(4))}</h3>;
        if (line.startsWith('- ')) return <p className="markdown-list-item" key={key}>{inlineText(line.slice(2))}</p>;
        return <p key={key}>{inlineText(line)}</p>;
      })}
    </article>
  );
}
