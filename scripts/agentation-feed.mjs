#!/usr/bin/env node
// agentation-feed — read/resolve Agentation annotations over the local server's
// REST API (the `agentation-mcp server` on port 4747). A standalone alternative
// to the MCP tools: pipe pending feedback to any agent, or watch the live SSE
// stream. Zero deps (Node 18+ global fetch).
//
// Usage:
//   node scripts/agentation-feed.mjs pending        # dump all pending annotations
//   node scripts/agentation-feed.mjs watch          # live-stream new annotations (SSE)
//   node scripts/agentation-feed.mjs resolve <id> [summary…]
//   node scripts/agentation-feed.mjs reply   <id> <message…>
//
// Env: AGENTATION_PORT (default 4747), AGENTATION_HOST (default 127.0.0.1).

const HOST = process.env.AGENTATION_HOST || '127.0.0.1';
const PORT = process.env.AGENTATION_PORT || '4747';
const BASE = `http://${HOST}:${PORT}`;

async function api(path, init) {
  const res = await fetch(BASE + path, init);
  const body = await res.text();
  let json; try { json = JSON.parse(body); } catch { json = body; }
  if (!res.ok) throw new Error(`${res.status} ${path} — ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  return json;
}

// Render one annotation as a ready-to-act markdown block, mirroring the overlay's
// "Page Feedback" Send/Copy output so the agent sees the same structure either way.
function fmt(a) {
  const pos = a.boundingBox
    ? `${Math.round(a.boundingBox.width)}×${Math.round(a.boundingBox.height)}px @ (${Math.round(a.boundingBox.x)}, ${Math.round(a.boundingBox.y)})`
    : `x:${a.x} y:${a.y}`;
  return [
    `### [${a.id}] ${a.element || 'element'} — ${a.status}`,
    a.url ? `**URL:** ${a.url}` : null,
    `**DOM path:** ${a.elementPath || '—'}`,
    a.cssClasses ? `**Classes:** ${a.cssClasses}` : null,
    `**Position:** ${pos}`,
    a.selectedText ? `**Selected text:** ${a.selectedText}` : null,
    a.computedStyles ? `**Computed styles:** ${a.computedStyles}` : null,
    `**Feedback:** ${a.comment || '(no comment)'}`,
  ].filter(Boolean).join('\n');
}

async function pending() {
  const { count, annotations } = await api('/pending');
  if (!count) { console.log('No pending annotations.'); return; }
  console.log(`## ${count} pending annotation${count > 1 ? 's' : ''}\n`);
  console.log(annotations.map(fmt).join('\n\n---\n\n'));
}

async function resolve([id, ...rest]) {
  if (!id) throw new Error('resolve needs an annotation id');
  const summary = rest.join(' ') || undefined;
  await api(`/annotations/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'resolved', resolvedBy: 'agent', summary }),
  });
  console.log(`Resolved ${id}${summary ? ` — ${summary}` : ''}`);
}

async function reply([id, ...rest]) {
  if (!id || !rest.length) throw new Error('reply needs <id> and a message');
  await api(`/annotations/${id}/thread`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'agent', content: rest.join(' ') }),
  });
  console.log(`Replied on ${id}`);
}

// Subscribe to the global SSE stream and print each new/updated annotation.
async function watch() {
  console.log(`Watching ${BASE}/events … (Ctrl+C to stop)\n`);
  const res = await fetch(`${BASE}/events`, { headers: { accept: 'text/event-stream' } });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const chunks = buf.split('\n\n');
    buf = chunks.pop();                       // keep the trailing partial frame
    for (const chunk of chunks) {
      const evt = (chunk.match(/^event:\s*(.+)$/m) || [])[1];
      const dataLine = (chunk.match(/^data:\s*(.+)$/m) || [])[1];
      if (!evt || !dataLine || !evt.startsWith('annotation.')) continue;
      try {
        const { payload } = JSON.parse(dataLine);
        console.log(`\n[${evt}]`);
        console.log(fmt(payload));
      } catch { /* ignore keep-alives / malformed frames */ }
    }
  }
}

const [cmd, ...args] = process.argv.slice(2);
const run = { pending, watch, resolve: () => resolve(args), reply: () => reply(args) }[cmd] || pending;
run(args).catch((e) => { console.error('✗', e.message); process.exit(1); });
