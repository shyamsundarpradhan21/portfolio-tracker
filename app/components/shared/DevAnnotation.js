'use client';

// Dev-only visual-feedback overlay (Agentation). Click any element on the page
// to annotate it; annotations POST to the local `agentation-mcp server`
// (port 4747), which the coding agent reads over MCP — no screenshot/paste.
// Never rendered in production: layout.js gates this on NODE_ENV.
import { Agentation } from 'agentation';

export default function DevAnnotation() {
  return <Agentation endpoint="http://localhost:4747" />;
}
