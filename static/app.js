const $ = (id) => document.getElementById(id);
const terminalStates = new Set(['completed', 'partial', 'failed', 'expired']);
let pollTimer = null;

function linksReady(job) {
  const total = Number(job.total_files || 0);
  const done = Number(job.completed_files || 0);
  const failed = Number(job.failed_files || 0);
  return terminalStates.has(job.state) || Boolean(job.zip_url && total > 0 && done >= total && failed === 0);
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return 'Size unavailable';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** power).toFixed(power ? 1 : 0)} ${units[power]}`;
}

function formatDuration(value) {
  const seconds = Number(value || 0);
  if (!seconds) return '';
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function fileIcon(file) {
  const name = String(file.name || '').toLowerCase();
  if (/\.(mp4|mkv|mov|avi|webm|m4v)$/.test(name)) return '▶';
  if (/\.(jpg|jpeg|png|gif|webp)$/.test(name)) return '▧';
  if (/\.(zip|rar|7z)$/.test(name)) return '⌁';
  return '•';
}

function progressValue(job) {
  const total = Number(job.total_files || 0);
  const done = Number(job.completed_files || 0);
  return total ? Math.max(4, Math.min(100, Math.round(done / total * 100))) : job.state === 'completed' ? 100 : 6;
}

function renderFiles(files) {
  $('fileGrid').innerHTML = (Array.isArray(files) ? files : []).map((file) => {
    const name = escapeHtml(file.name || 'Unnamed file');
    const poster = file.poster ? `<img src="${escapeHtml(file.poster)}" alt="" loading="lazy">` : fileIcon(file);
    const state = escapeHtml(file.state || 'ready');
    const duration = formatDuration(file.duration_s);
    const open = file.download_url ? `<a class="file-open" href="${escapeHtml(file.download_url)}" target="_blank" rel="noopener"><span>Open</span><b>↗</b></a>` : '<span class="file-unavailable">Unavailable</span>';
    return `<article class="file-card"><div class="file-thumb">${poster}</div><div class="file-info"><div class="file-name" title="${name}">${name}</div><div class="file-meta"><span>${formatBytes(file.size)}</span>${duration ? `<i></i><span>${duration}</span>` : ''}<i></i><span class="file-state">${state}</span></div></div>${open}</article>`;
  }).join('');
}

function render(job) {
  const ready = linksReady(job);
  const total = Number(job.total_files || 0);
  const done = Number(job.completed_files || 0);
  const percent = progressValue(job);
  $('progressPanel').classList.add('show');
  $('progressBar').style.width = `${percent}%`;
  $('progressPercent').textContent = `${percent}%`;
  $('progressCount').textContent = `${done} of ${total || '?'} files processed`;

  if (ready) {
    $('progressTitle').textContent = job.state === 'partial' ? 'Partially ready' : 'Processing complete';
    $('progressText').textContent = job.state === 'partial' ? 'Some files were unavailable, but the available links are ready.' : 'Your download links are ready below.';
    $('resultsMeta').textContent = `${done} of ${total || done} files ready${job.name ? ` · ${job.name}` : ''}`;
    $('filesCount').textContent = `${(job.files || []).length} files`;
    $('zipButton').style.display = job.zip_url ? 'flex' : 'none';
    $('zipButton').href = job.zip_url || '#';
    renderFiles(job.files);
    $('resultsPanel').classList.add('show');
    $('start').disabled = false;
    $('reset').style.display = 'block';
    clearInterval(pollTimer);
  } else if (job.state === 'failed' || job.state === 'expired') {
    showError(job.error || `Request ${job.state}.`);
    $('start').disabled = false;
  } else {
    $('progressTitle').textContent = 'Processing your link';
    $('progressText').textContent = `${done} of ${total || '?'} files processed`;
    $('start').disabled = true;
  }
}

function showError(message) {
  $('errorBox').textContent = message;
  $('errorBox').classList.add('show');
}

async function readStatus(jobId) {
  const response = await fetch(`/api/mega/status?id=${encodeURIComponent(jobId)}`);
  const job = await response.json();
  if (!response.ok) throw new Error(job.message || job.error || 'Unable to read status.');
  render(job);
  return job;
}

function poll(jobId) {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const job = await readStatus(jobId);
      if (linksReady(job)) clearInterval(pollTimer);
    } catch (error) {
      clearInterval(pollTimer);
      showError(error.message);
      $('start').disabled = false;
    }
  }, 3000);
}

$('start').addEventListener('click', async () => {
  const url = $('megaUrl').value.trim();
  if (!url) return showError('Paste a MEGA link first.');
  $('errorBox').classList.remove('show');
  $('resultsPanel').classList.remove('show');
  $('reset').style.display = 'none';
  $('start').disabled = true;
  try {
    const response = await fetch(`/api/mega?url=${encodeURIComponent(url)}`);
    const job = await response.json();
    if (!response.ok) throw new Error(job.message || job.error || 'Unable to process this link.');
    render(job);
    if (!linksReady(job)) poll(job.job_id);
  } catch (error) {
    showError(error.message);
    $('start').disabled = false;
  }
});

$('reset').addEventListener('click', () => {
  clearInterval(pollTimer);
  $('megaUrl').value = '';
  $('progressPanel').classList.remove('show');
  $('resultsPanel').classList.remove('show');
  $('errorBox').classList.remove('show');
  $('reset').style.display = 'none';
  $('start').disabled = false;
  $('megaUrl').focus();
});
