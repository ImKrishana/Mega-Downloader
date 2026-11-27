import { getDecryptedDownloadStream } from './mega_core.js';

export async function GET(request) {
  const urlObj = new URL(request.url, 'http://localhost:3000');
  const folderId = urlObj.searchParams.get('f') || null;
  const nodeId = urlObj.searchParams.get('n');
  const token = urlObj.searchParams.get('k');
  const filename = urlObj.searchParams.get('fn') || 'download.bin';

  if (!nodeId || !token) {
    return new Response('Missing required download parameters (n, k).', { status: 400 });
  }

  try {
    const { stream, fileSize } = await getDecryptedDownloadStream({ folderId, nodeId, token });
    const encodedName = encodeURIComponent(filename);

    const headers = new Headers();
    headers.set('Content-Type', 'application/octet-stream');
    headers.set('Content-Disposition', `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`);
    if (fileSize > 0) {
      headers.set('Content-Length', String(fileSize));
    }
    headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');

    return new Response(stream, {
      status: 200,
      headers
    });
  } catch (err) {
    return new Response(`Download error: ${err.message}`, { status: 502 });
  }
}

export const config = { runtime: 'nodejs', maxDuration: 120 };
