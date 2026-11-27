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
  const id = urlObj.searchParams.get('id');

  if (!id) {
    return json({ error: 'missing_id', message: 'Provide a valid job id.' }, 400);
  }

  // Jobs in direct mode resolve immediately on the /api/mega request.
  return json({
    job_id: id,
    state: 'completed',
    completed_files: 1,
    failed_files: 0
  }, 200);
}

export const config = { runtime: 'nodejs', maxDuration: 10 };
