const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT) || 3456;
const ROOT = __dirname;
// 2026-11-07: Khách hàng cần lưu cache âm thanh local và lưu tiến trình làm việc lâu dài để tắt mở lại không phải tải hay làm lại từ đầu; trước đó lưu ở os.tmpdir() dễ bị xóa tạm thời, nay chuyển về thư mục .studio_cache ngay trong dự án.
const CACHE_DIR = path.join(ROOT, '.studio_cache');
const WORKSPACE_FILE = path.join(CACHE_DIR, 'workspace_state.json');
const SERVER_LOG = path.join(CACHE_DIR, 'server.log');

function serverLog(message, details) {
  try { fs.appendFileSync(SERVER_LOG, `[${new Date().toISOString()}] ${message}${details ? ` ${JSON.stringify(details)}` : ''}\n`, 'utf8'); } catch (e) {}
}

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav'
};

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader(
    'Access-Control-Expose-Headers',
    'X-Video-Title, X-Video-Author, X-Video-Id, X-Video-Duration, Content-Length, Content-Range'
  );
}

function extractVideoId(input) {
  const s = String(input || '').trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.split('/').filter(Boolean)[0];
      if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
    }
    if (u.searchParams.has('v')) {
      const id = u.searchParams.get('v');
      if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
    }
    const parts = u.pathname.split('/').filter(Boolean);
    const idx = parts.findIndex((p) => ['shorts', 'embed', 'live', 'v'].includes(p));
    if (idx >= 0 && parts[idx + 1] && /^[a-zA-Z0-9_-]{11}$/.test(parts[idx + 1])) {
      return parts[idx + 1];
    }
  } catch (e) {}
  const m = s.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    const extraFfmpeg = 'D:\\ffmpeg-8.0.1-essentials_build\\bin';
    if (fs.existsSync(extraFfmpeg) && !String(env.PATH || '').includes(extraFfmpeg)) {
      env.PATH = `${extraFfmpeg};${env.PATH || ''}`;
    }
    const pythonCandidates = [
      process.env.PYTHON,
      'C:\\Users\\maith\\AppData\\Local\\Programs\\Python\\Python314\\python.exe',
      'C:\\Users\\maith\\AppData\\Local\\Programs\\Python\\Python313\\python.exe',
      'python'
    ].filter(Boolean);
    const pythonExe = pythonCandidates.find((candidate) => candidate === 'python' || fs.existsSync(candidate)) || 'python';
    const proc = spawn(pythonExe, ['-m', 'yt_dlp', ...args], { env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
    });
  });
}

async function getYoutubeAudio(videoId) {
  const metaPath = path.join(CACHE_DIR, `${videoId}.json`);
  if (fs.existsSync(metaPath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (cached && cached.filePath && fs.existsSync(cached.filePath)) {
        return cached;
      }
    } catch (e) {}
  }

  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const outTemplate = path.join(CACHE_DIR, `${videoId}.%(ext)s`);

  const infoRaw = await runYtDlp([
    '--no-playlist',
    '--no-warnings',
    '-f',
    'bestaudio[ext=m4a][abr<=160]/bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio',
    '--ppa',
    'FixupM4a:-movflags +faststart',
    '-o',
    outTemplate,
    '--print-json',
    ytUrl
  ]);

  const lines = infoRaw.split(/\r?\n/).filter(Boolean);
  const info = JSON.parse(lines[lines.length - 1]);
  const ext = info.ext || 'm4a';
  let filePath = info._filename || path.join(CACHE_DIR, `${videoId}.${ext}`);

  if (!fs.existsSync(filePath)) {
    const found = fs.readdirSync(CACHE_DIR).find((f) => f.startsWith(videoId + '.') && !f.endsWith('.json'));
    if (found) filePath = path.join(CACHE_DIR, found);
  }

  const meta = {
    videoId,
    title: info.title || `YouTube (${videoId})`,
    author: info.uploader || info.channel || 'YouTube',
    duration: Number(info.duration) || 0,
    ext: path.extname(filePath).toLowerCase(),
    filePath
  };

  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}

function createStudioServer() {
  return http.createServer(async (req, res) => {
    setCors(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (reqUrl.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, service: 'nebula-lyric-studio', cacheDir: CACHE_DIR }));
      return;
    }

    if (reqUrl.pathname === '/api/workspace') {
      if (req.method === 'GET') {
        if (fs.existsSync(WORKSPACE_FILE)) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          fs.createReadStream(WORKSPACE_FILE).pipe(res);
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end('null');
        }
        return;
      }
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          try {
            fs.writeFileSync(WORKSPACE_FILE, body, 'utf8');
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: true }));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, error: err.message }));
          }
        });
        return;
      }
    }

    if (reqUrl.pathname === '/api/library' && req.method === 'GET') {
      const exportDir = path.join(ROOT, 'exports');
      const files = fs.existsSync(exportDir) ? fs.readdirSync(exportDir).map((name) => {
        const full = path.join(exportDir, name);
        const stat = fs.statSync(full);
        return { name, size: stat.size, updatedAt: stat.mtime.toISOString(), url: `/exports/${encodeURIComponent(name)}` };
      }).filter((x) => /\.(json|mp4|webm|jpg|png|txt|zip)$/i.test(x.name)) : [];
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(files.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))));
      return;
    }

    if (reqUrl.pathname === '/api/library/delete' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk.toString()));
      req.on('end', () => {
        try {
          const names = JSON.parse(body).names;
          if (!Array.isArray(names)) throw new Error('names must be an array');
          for (const name of names) {
            const safe = path.basename(String(name));
            const full = path.join(ROOT, 'exports', safe);
            if (full.startsWith(path.join(ROOT, 'exports')) && fs.existsSync(full)) fs.rmSync(full);
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    if (reqUrl.pathname === '/api/agent-package' && req.method === 'POST') {
      serverLog('agent-package:start');
      let body = '';
      req.on('data', (chunk) => (body += chunk.toString()));
      req.on('end', async () => {
        const tempDir = path.join(CACHE_DIR, `agent-package-${Date.now()}`);
        try {
          const payload = JSON.parse(body);
          serverLog('agent-package:payload', { hasAudio: Boolean(payload.audioBase64), audioName: payload.audioName });
          fs.mkdirSync(tempDir, { recursive: true });
          fs.writeFileSync(path.join(tempDir, 'project.json'), JSON.stringify(payload.project || {}, null, 2), 'utf8');
          fs.writeFileSync(path.join(tempDir, 'PROMPT.txt'), String(payload.prompt || ''), 'utf8');
          if (payload.audioBase64) fs.writeFileSync(path.join(tempDir, path.basename(payload.audioName || 'audio.m4a')), Buffer.from(payload.audioBase64, 'base64'));
          const zipPath = `${tempDir}.zip`;
          await new Promise((resolve, reject) => {
            const ps = spawn('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path ${JSON.stringify(tempDir + '\\*')} -DestinationPath ${JSON.stringify(zipPath)} -Force`], { windowsHide: true });
            ps.on('error', reject); ps.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Compress-Archive ${code}`)));
          });
          const stat = fs.statSync(zipPath);
          res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': stat.size, 'Content-Disposition': 'attachment; filename="nebula-agent-package.zip"' });
          serverLog('agent-package:done', { bytes: stat.size });
          fs.createReadStream(zipPath).pipe(res).on('close', () => { fs.rmSync(tempDir, { recursive: true, force: true }); fs.rmSync(zipPath, { force: true }); });
        } catch (err) {
          serverLog('agent-package:error', { message: err.message });
          fs.rmSync(tempDir, { recursive: true, force: true });
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    if (reqUrl.pathname === '/api/agent-folder' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk.toString()));
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const folder = path.join(ROOT, 'exports', `nebula-agent-package-${stamp}`);
          fs.mkdirSync(folder, { recursive: true });
          fs.writeFileSync(path.join(folder, 'project.json'), String(payload.projectJson || '{}'), 'utf8');
          fs.writeFileSync(path.join(folder, 'PROMPT.txt'), String(payload.prompt || ''), 'utf8');
          fs.writeFileSync(path.join(folder, path.basename(payload.audioName || 'audio.m4a')), Buffer.from(payload.audioBase64 || '', 'base64'));
          serverLog('agent-folder:done', { folder });
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, folder }));
        } catch (err) {
          serverLog('agent-folder:error', { message: err.message });
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    if (reqUrl.pathname === '/api/youtube') {
      const rawUrl = reqUrl.searchParams.get('url') || reqUrl.searchParams.get('v') || '';
      const videoId = extractVideoId(rawUrl);
      if (!videoId) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Link YouTube không hợp lệ.' }));
        return;
      }

      try {
        const meta = await getYoutubeAudio(videoId);
        const stat = fs.statSync(meta.filePath);
        const mime = MIME_TYPES[meta.ext] || 'audio/mp4';

        res.setHeader('X-Video-Id', meta.videoId);
        res.setHeader('X-Video-Title', encodeURIComponent(meta.title));
        res.setHeader('X-Video-Author', encodeURIComponent(meta.author));
        res.setHeader('X-Video-Duration', String(meta.duration || 0));
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

        const range = req.headers.range;
        if (range) {
          const parts = range.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
          const chunkSize = end - start + 1;
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Content-Length': chunkSize,
            'Content-Type': mime
          });
          fs.createReadStream(meta.filePath, { start, end }).pipe(res);
        } else {
          res.writeHead(200, {
            'Content-Length': stat.size,
            'Content-Type': mime
          });
          fs.createReadStream(meta.filePath).pipe(res);
        }
      } catch (err) {
        console.error('YouTube extract error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Không thể tách âm thanh từ video này.', detail: err.message }));
      }
      return;
    }

    // Static files
    let relPath = decodeURIComponent(reqUrl.pathname);
    if (relPath === '/') relPath = '/index.html';
    const safePath = path.normalize(path.join(ROOT, relPath));
    if (!safePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
      const ext = path.extname(safePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(safePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });
}

function startStudioServer(port = PORT) {
  return new Promise((resolve) => {
    const srv = createStudioServer();
    srv.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        // Already running on this port
        resolve({ port, alreadyRunning: true });
      } else {
        console.error('Server error:', err);
        resolve({ port, error: err });
      }
    });
    srv.listen(port, '127.0.0.1', () => {
      console.log(`Nebula Lyric Studio Server running at http://127.0.0.1:${port}`);
      resolve({ port, server: srv });
    });
  });
}

if (require.main === module) {
  startStudioServer(PORT);
}

module.exports = { startStudioServer, PORT };
