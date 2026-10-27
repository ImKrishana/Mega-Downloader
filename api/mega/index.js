import { resolveMega } from './mega_core.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

export async function GET(request) {
  if (request.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const urlObj = new URL(request.url, 'http://localhost:3000');
  const inputUrl = urlObj.searchParams.get('url');

  if (!inputUrl) {
    return json({
      error: 'invalid_url',
      message: 'Provide a valid mega.nz file or folder URL. Encode # as %23 in the query string.'
    }, 400);
  }

  try {
    const result = await resolveMega(inputUrl);
    const jobId = Math.random().toString(36).substring(2, 14);

    const formattedFiles = result.files.map(f => {
      const q = new URLSearchParams();
      if (f.folder_id) q.set('f', f.folder_id);
      q.set('n', f.node_id);
      q.set('k', f.download_token);
      q.set('fn', f.name);

      return {
        name: f.name,
        size: f.size,
        state: 'ready',
        poster: null,
        download_url: `/api/mega/download?${q.toString()}`,
        width: null,
        height: null,
        duration_s: null
      };
    });

    return json({
      job_id: jobId,
      state: 'completed',
      name: result.name,
      total_files: result.total_files,
      total_size: result.total_size,
      completed_files: result.total_files,
      failed_files: 0,
      zip_url: null,
      files: formattedFiles
    }, 200);

  } catch (err) {
    return json({
      error: 'mega_error',
      message: err.message || 'Failed to process MEGA link.'
    }, 502);
  }
}

export const config = { runtime: 'nodejs', maxDuration: 60 };
