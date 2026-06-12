import {
  fetchPaperclipAttachment,
  PaperclipConfigurationError,
} from '../../../../lib/paperclip/client';

const ATTACHMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

async function readLimitedBody(response) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ATTACHMENT_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks, total);
}

export default async function handler(req, res) {
  res.setHeader('Allow', 'GET');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query;
  if (typeof id !== 'string' || !ATTACHMENT_ID_PATTERN.test(id)) {
    return res.status(400).json({ error: 'Invalid attachment id' });
  }

  try {
    const response = await fetchPaperclipAttachment(id);
    if (!response.ok) {
      return res.status(response.status === 404 ? 404 : 502).json({ error: 'Attachment unavailable' });
    }

    const contentType = String(response.headers.get('content-type') || '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      return res.status(415).json({ error: 'Attachment image type is not supported' });
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_ATTACHMENT_BYTES) {
      return res.status(413).json({ error: 'Attachment is too large' });
    }

    const buffer = await readLimitedBody(response);
    if (!buffer) {
      return res.status(413).json({ error: 'Attachment is too large' });
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'private, max-age=120');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).send(buffer);
  } catch (error) {
    if (error instanceof PaperclipConfigurationError) {
      return res.status(503).json({ error: error.state });
    }
    console.error('Paperclip attachment proxy failed:', error);
    return res.status(502).json({ error: 'Attachment proxy failed' });
  }
}
