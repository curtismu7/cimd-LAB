import talk from '../../../docs/talk-track.md?raw';

// A tiny renderer for our own talk track file: # / ## headings, "- " bullets, paragraphs. React text only.
export function parseTalk(source) {
  const blocks = [];
  let list = null;
  for (const line of source.split('\n')) {
    if (/^- /.test(line)) { (list ??= { type: 'ul', items: [] }).items.push(line.slice(2)); continue; }
    if (list) { blocks.push(list); list = null; }
    if (/^##\s/.test(line)) blocks.push({ type: 'h3', text: line.replace(/^##\s+/, '') });
    else if (/^#\s/.test(line)) blocks.push({ type: 'h2', text: line.replace(/^#\s+/, '') });
    else if (line.trim()) blocks.push({ type: 'p', text: line.trim() });
  }
  if (list) blocks.push(list);
  return blocks;
}

export default function TalkTrack({ source = talk }) {
  return (
    <div className="view talk">
      {parseTalk(source).map((b, i) => {
        if (b.type === 'h2') return <h2 key={i}>{b.text}</h2>;
        if (b.type === 'h3') return <h3 key={i}>{b.text}</h3>;
        if (b.type === 'ul') return <ul key={i}>{b.items.map((t, j) => <li key={j}>{t}</li>)}</ul>;
        return <p key={i}>{b.text}</p>;
      })}
    </div>
  );
}
