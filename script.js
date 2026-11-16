(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const canvas = $('scene'),
    ctx = canvas.getContext('2d', { alpha: false });
  const W = 1600,
    H = 900,
    EXPORT_W = 1920,
    EXPORT_H = 1080;
  const audio = $('audio');
  const KEY = 'nebula_lyric_project_v3';
  const LOCAL_API_BASE =
    location.protocol === 'file:' ||
    ((location.hostname === 'localhost' || location.hostname === '127.0.0.1') && location.port !== '3456')
      ? 'http://127.0.0.1:3456'
      : '';
  const DEBUG_LOG_KEY = 'nebula_debug_log_v2';
  let debugEntries = JSON.parse(localStorage.getItem(DEBUG_LOG_KEY) || '[]');
  function debugLog(message, details) {
    const entry = `[${new Date().toLocaleTimeString()}] ${message}${details ? ` ${JSON.stringify(details)}` : ''}`;
    debugEntries = [...debugEntries.slice(-199), entry];
    localStorage.setItem(DEBUG_LOG_KEY, JSON.stringify(debugEntries));
    console.log('[Nebula]', entry);
    const output = $('debugLogText');
    if (output) output.textContent = debugEntries.join('\n');
  }

  const DEFAULT_LYRICS = [
    {
      id: 1,
      start: 0,
      end: 4.3,
      text: 'Giữa ngân hà vạn vì sao sáng',
      mode: 'queue',
      timingIn: 0.75,
      timingMid: 1.5,
      timingOut: 0.75
    },
    {
      id: 2,
      start: 4.5,
      end: 9.3,
      text: 'Giai điệu trôi qua những giấc mơ đêm',
      mode: 'queue',
      timingIn: 0.75,
      timingMid: 1.5,
      timingOut: 0.75
    },
    {
      id: 3,
      start: 9.6,
      end: 15.5,
      text: 'Và tim vẫn ngân nga lời hát\nChỉ dành cho riêng chúng ta',
      mode: 'queue',
      timingIn: 0.75,
      timingMid: 1.5,
      timingOut: 0.75
    }
  ];

  // 2026-11-07: Khách hàng muốn có tùy chọn 'none' (Không dùng hiệu ứng) và kiểu chạy chữ 'queue' (cuộn hàng đợi: từ dưới nhỏ lên giữa to rồi lên trên nhỏ lại biến mất); trước đó thiếu 'none' và 'queue' nên bắt buộc chọn hiệu ứng cũ, do đó cần bổ sung 'none' và 'queue' vào VALID_WEATHERS / VALID_MODES và đặt 'queue' làm mặc định.
  const VALID_WEATHERS = ['none', 'galaxy', 'sun', 'snow', 'rain', 'petal'];
  const VALID_MODES = ['queue', 'bounce', 'soft', 'slide', 'none', 'poem'];

  const DEFAULT = {
    weather: 'galaxy',
    density: 65,
    dim: 38,
    font: 'oswald',
    position: 'center',
    lyricMode: 'queue',
    lyricDirection: 'up',
    fontSize: 60,
    glow: 68,
    textColor: '#ffffff',
    accentColor: '#ffffff',
    lyrics: DEFAULT_LYRICS
  };

  let data = structuredClone(DEFAULT);

  // 2026-11-07: Khách hàng mong muốn giao diện mặc định mang phong cách Galaxy và giữ đúng cấu hình dự án đã lưu kèm timing riêng từng đoạn lời; trước đó bộ lọc chỉ nhận 4 thời tiết cũ và thiếu timingIn/timingMid/timingOut trên từng đoạn, nên cần kiểm tra hợp lệ VALID_WEATHERS và chuẩn hóa timingIn/timingMid/timingOut cho mỗi câu lời.
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && Array.isArray(saved.lyrics)) {
      const restoredFont = ['oswald', 'vietnam', 'elegant', 'modern', 'poetic'].includes(saved.font)
        ? saved.font
        : 'oswald';
      const restoredWeather = VALID_WEATHERS.includes(saved.weather) ? saved.weather : 'galaxy';
      const restoredMode = VALID_MODES.includes(saved.lyricMode)
        ? saved.lyricMode
        : VALID_MODES.includes(saved.lyrics[0]?.mode)
        ? saved.lyrics[0].mode
        : 'queue';
      data = {
        ...data,
        ...saved,
        weather: restoredWeather,
        font: restoredFont,
        lyricMode: restoredMode,
        fontSize: Number(saved.fontSize) || 60,
        lyrics: saved.lyrics
          .filter((x) => x && typeof x.text === 'string')
          .map((x) => ({
            id: x.id || Date.now() + Math.random(),
            text: x.text,
            icon: String(x.icon || ''),
            words: Array.isArray(x.words) ? x.words : undefined,
            start: Math.max(0, Number(x.start) || 0),
            end: Math.max(0, Number(x.end) || 0),
            mode: restoredMode,
            timingIn: Math.max(0.1, Number(x.timingIn) || 0.75),
            timingMid: Math.max(0, Number(x.timingMid ?? 1.5)),
            timingOut: Math.max(0.1, Number(x.timingOut) || 0.75)
          }))
      };
    }
  } catch (e) {
    /* ignore corrupted storage */
  }

  let background = null,
    imageURL = null,
    audioURL = null,
    activeAudioBlob = null,
    audioReady = false;
  let pcmBuffer = null,
    pcmReady = false,
    pcmSource = null,
    pcmOffset = 0,
    pcmStartWall = 0;
  let ytPlayer = null,
    ytReady = false,
    ytDuration = 0,
    currentYtId = null;
  let playing = false,
    demoTime = 1.15,
    lastStamp = 0,
    activeId = null,
    selectedSegId = null,
    previewSegId = null,
    previewSegEnd = null,
    stickers = [],
    selectedStickerId = null,
    audioGeneration = 0,
    canvasStickerInteracted = false,
    exportRecorder = null,
    exportStream = null;
  let audioContext = null,
    audioSource = null,
    audioDestination = null,
    recordingChunks = [];
  let toastTimeout = 0,
    saveWorkspaceTimer = 0,
    saveStickersTimer = 0;

  // 2026-11-07: Khách hàng phản ánh bấm Phát thử bị lag và khi tắt mở lại bị mất tiến trình đang làm dở; bổ sung IndexedDB (nebula_studio_idb) để cache toàn bộ file nhạc/YouTube Blob, ảnh nền, ảnh/GIF tách nền cùng tiến trình, kết hợp giải mã nhạc sang AudioBuffer trong RAM để phát thử và tua 0ms không độ trễ.
  const IDB_NAME = 'nebula_studio_idb';
  const IDB_STORE = 'kv';
  let idbPromise = null;

  function openStudioIdb() {
    if (idbPromise) return idbPromise;
    idbPromise = new Promise((resolve) => {
      if (!('indexedDB' in window)) return resolve(null);
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    return idbPromise;
  }

  async function idbGet(key) {
    const db = await openStudioIdb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function idbSet(key, val) {
    const db = await openStudioIdb();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(val, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  function ensureAudioContextSync() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioDestination = audioContext.createMediaStreamDestination();
    }
    return audioContext;
  }

  function stopPcmSource() {
    if (pcmSource) {
      try {
        pcmSource.onended = null;
        pcmSource.stop();
        pcmSource.disconnect();
      } catch (e) {}
      pcmSource = null;
    }
  }

  function startPcmSourceAt(offsetSec) {
    if (!pcmReady || !pcmBuffer) return;
    ensureAudioContextSync();
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }
    stopPcmSource();
    const clamped = clamp(offsetSec, 0, Math.max(0, pcmBuffer.duration - 0.01));
    pcmOffset = clamped;
    pcmStartWall = audioContext.currentTime;
    const src = audioContext.createBufferSource();
    src.buffer = pcmBuffer;
    src.connect(audioContext.destination);
    if (audioDestination) src.connect(audioDestination);
    src.start(0, clamped);
    pcmSource = src;
  }

  const seed = (n) => {
    const r = Math.sin(n * 127.1 + 15.7) * 43758.5453;
    return r - Math.floor(r);
  };

  const particles = Array.from({ length: 240 }, (_, i) => ({
    x: seed(i + 10),
    y: seed(i + 201),
    v: seed(i + 500),
    z: seed(i + 900),
    phase: seed(i + 1200) * Math.PI * 2,
    hue: i % 4
  }));

  const clamp = (n, a = 0, b = 1) => Math.min(b, Math.max(a, n));
  const smooth = (x) => {
    x = clamp(x);
    return x * x * (3 - 2 * x);
  };
  const outCubic = (x) => 1 - Math.pow(1 - clamp(x), 3);
  const inOutCubic = (x) => {
    x = clamp(x);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  };
  const outBack = (x) => {
    x = clamp(x);
    const c = 1.70158;
    return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
  };
  const mod = (a, b) => ((a % b) + b) % b;

  const secText = (t) => {
    t = Math.max(0, Number(t) || 0);
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const cs = Math.floor((t - Math.floor(t)) * 100 + 0.0001);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  };

  const parseTime = (s) => {
    if (typeof s === 'number') return s;
    s = String(s).trim().replace(',', '.');
    if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
    const a = s.split(':').map(Number);
    if (a.some((x) => !Number.isFinite(x)) || a.length > 3) return NaN;
    return a.reduce((v, n) => v * 60 + n, 0);
  };

  let historyReady = false, historyApplying = false, historyTimer = 0;
  let undoStack = [], redoStack = [], historyCurrent = null;
  const historySnapshot = () => ({data: structuredClone(data), stickers: stickers.map(st => ({...st})), selectedSegId, selectedStickerId});
  const historyKey = state => JSON.stringify([state.data, state.stickers.map(st => Object.fromEntries(Object.entries(st).filter(([k,v]) => v === null || ['string','number','boolean'].includes(typeof v))))]);
  function updateHistoryButtons() {
    $('undoBtn').disabled = !undoStack.length;
    $('redoBtn').disabled = !redoStack.length;
  }
  function commitHistory() {
    clearTimeout(historyTimer);
    if (!historyReady || historyApplying) return;
    const next = historySnapshot();
    if (historyKey(next) !== historyKey(historyCurrent)) {
      undoStack.push(historyCurrent);
      if (undoStack.length > 50) undoStack.shift();
      redoStack = []; historyCurrent = next;
    }
    updateHistoryButtons();
  }
  function scheduleHistory() {
    if (!historyReady || historyApplying) return;
    clearTimeout(historyTimer); historyTimer = setTimeout(commitHistory, 350);
  }
  function travelHistory(redo) {
    commitHistory();
    const source = redo ? redoStack : undoStack;
    if (!source.length || recording()) return;
    (redo ? undoStack : redoStack).push(historyCurrent);
    const state = source.pop(); historyApplying = true;
    pause(); data = structuredClone(state.data); stickers = state.stickers.map(st => ({...st}));
    selectedSegId = state.selectedSegId; selectedStickerId = state.selectedStickerId;
    applyData(); buildStickerList(); persist(); persistStickers();
    historyCurrent = historySnapshot(); historyApplying = false; updateHistoryButtons();
  }
  $('undoBtn').addEventListener('click', () => travelHistory(false));
  $('redoBtn').addEventListener('click', () => travelHistory(true));
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key !== 'z' && key !== 'y') return;
    if (e.target.matches('input, textarea, [contenteditable]')) return;
    e.preventDefault(); travelHistory(key === 'y' || e.shiftKey);
  });
  document.addEventListener('pointerdown', commitHistory, true);
  document.addEventListener('focusout', commitHistory);
  const persist = () => {
    scheduleHistory();
    try {
      const payload = {
        ...data,
        _selectedSegId: selectedSegId,
        _selectedStickerId: selectedStickerId,
        _ytUrl: $('ytUrlInput') ? $('ytUrlInput').value : '',
        _updatedAt: Date.now()
      };
      const jsonStr = JSON.stringify(payload);
      localStorage.setItem(KEY, jsonStr);
      clearTimeout(saveWorkspaceTimer);
      saveWorkspaceTimer = setTimeout(() => {
        fetch(`${LOCAL_API_BASE}/api/workspace`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: jsonStr
        }).catch(() => {});
      }, 350);
    } catch (e) {}
  };

  function persistStickers() {
    scheduleHistory();
    clearTimeout(saveStickersTimer);
    saveStickersTimer = setTimeout(() => {
      const records = stickers
        .filter((s) => s && (s.type === 'text' || s.blob))
        .map((s) => ({
          id: s.id,
          type: s.type === 'text' ? 'text' : 'image',
          name: s.name,
          text: s.text || '',
          font: s.font || 'oswald',
          textColor: s.textColor || '#ffffff',
          glowColor: s.glowColor || '#a78bfa',
          effectIn: s.effectIn || 'fade',
          effectOut: s.effectOut || 'fade',
          effectDuration: s.effectDuration || 0.45,
          blob: s.blob || null,
          x: s.x,
          y: s.y,
          scale: s.scale,
          opacity: s.opacity,
          layer: s.layer,
          alwaysOn: s.alwaysOn,
          start: s.start,
          end: s.end,
          removeBg: s.removeBg,
          bgColor: s.bgColor,
          tolerance: s.tolerance
        }));
      idbSet('active_stickers', records);
    }, 220);
  }

  const toast = (s) => {
    const e = $('toast');
    if (!e) return;
    e.textContent = s;
    e.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => e.classList.remove('show'), 3600);
  };

  // 2026-11-07: Khách hàng dùng thanh timeline để tua và bấm Phát thử liên tục; ưu tiên đọc thời gian từ pcmBuffer (AudioBuffer trong RAM) để phản hồi tức thì 0ms, sau đó tới thẻ <audio>, ytPlayer và demoTime.
  const totalTime = () => {
    if (pcmReady && pcmBuffer && pcmBuffer.duration > 0) return pcmBuffer.duration;
    if (audioReady && isFinite(audio.duration) && audio.duration > 0) return audio.duration;
    if (ytReady && ytDuration > 0) return ytDuration;
    return Math.max(20, ...data.lyrics.map((x) => x.end + 2));
  };

  const time = () => {
    if (pcmReady && pcmBuffer) {
      if (!playing) return pcmOffset;
      const cur = pcmOffset + (audioContext.currentTime - pcmStartWall);
      return clamp(cur, 0, pcmBuffer.duration);
    }
    if (audioReady) return audio.currentTime;
    if (ytReady && ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
      return Number(ytPlayer.getCurrentTime()) || 0;
    }
    return demoTime;
  };

  function setTime(t) {
    const v = clamp(t, 0, totalTime());
    if (pcmReady && pcmBuffer) {
      pcmOffset = v;
      if (playing) {
        startPcmSourceAt(v);
      }
    } else if (audioReady) {
      audio.currentTime = v;
    } else if (ytReady && ytPlayer && typeof ytPlayer.seekTo === 'function') {
      ytPlayer.seekTo(v, true);
    } else {
      demoTime = v;
    }
    draw(v);
    updateTransport(v);
  }

  // 2026-11-15: Khách hàng yêu cầu chuyển bộ chọn hiệu ứng hoạt ảnh xuống phần cài đặt chung ("Typography & ánh sáng chữ") để áp dụng đồng bộ cho toàn bài; trước đó chỉ nằm lẻ ở từng đoạn lời khiến khó chỉnh chung, nên đồng bộ #lyricModeSelect vào applyData() và dùng chung data.lyricMode.
  function applyData() {
    syncBeatControls();
    const setV = (id, val) => {
      const el = $(id);
      if (el) el.value = String(val);
    };
    setV('density', data.density);
    setV('dim', data.dim);
    setV('fontSelect', data.font);
    setV('positionSelect', data.position);
    setV('directionSelect',data.lyricDirection==='down'?'down':'up');
    setV('lyricModeSelect', VALID_MODES.includes(data.lyricMode) ? data.lyricMode : (data.lyrics[0]?.mode || 'queue'));
    setV('fontSize', data.fontSize);
    setV('glow', data.glow);
    setV('textColor', data.textColor);
    setV('accentColor', data.accentColor);
    ['density', 'dim', 'glow'].forEach((k) => {
      const el = $(k + 'Val');
      if (el) el.textContent = data[k] + '%';
    });
    if ($('fontSizeVal')) $('fontSizeVal').textContent = data.fontSize + ' px';
    document
      .querySelectorAll('.weather')
      .forEach((el) => el.classList.toggle('selected', el.dataset.weather === data.weather));
    const srcVid = String(data.beatEffect?.sourceVideoId || data.youtubeId || '');
    $('quickSong1Btn')?.classList.toggle('active', srcVid === '0zJkOay1Ly8');
    $('quickSong2Btn')?.classList.toggle('active', srcVid === 'EnnNI-RlM40');
    $('quickSong3Btn')?.classList.toggle('active', srcVid === 'n5D2aYJvis8');
    $('quickMedleyBtn')?.classList.toggle('active', srcVid.includes('0zJkOay1Ly8_EnnNI-RlM40'));
    clearAllTextArtworks();
    buildList();
    draw(time());
  }

  function validSegment(seg) {
    if (seg.end <= seg.start) seg.end = seg.start + 0.5;
    seg.start = Math.max(0, seg.start);
    seg.end = Math.max(0, seg.end);
    seg.timingIn = Math.max(0.1, Number(seg.timingIn) || 0.75);
    seg.timingMid = Math.max(0, Number(seg.timingMid ?? 1.5));
    seg.timingOut = Math.max(0.1, Number(seg.timingOut) || 0.75);
  }

  function sortedLyrics() {
    return [...data.lyrics].sort((a, b) => a.start - b.start);
  }

  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        })[c]
    );
  }

  // 2026-11-07: Khách hàng cần thanh thời gian tương tác ngay tại chỗ chỉnh thời điểm bắt đầu/kết thúc để kéo qua lại và bấm phát thử đoạn đó giúp chép lời nhanh; trước đó chỉ có ô nhập số thủ công gây khó căn mốc nhạc, nên cần bổ sung thanh kéo 2 đầu mốc (start/end) + con chạy tua trực tiếp và nút phát thử tự dừng đúng cuối câu.
  function getSegmentWindow(item, seg) {
    if (item && Number.isFinite(item._dragWinMin) && Number.isFinite(item._dragWinMax)) {
      return { winMin: item._dragWinMin, winMax: item._dragWinMax };
    }
    const total = Math.max(10, totalTime());
    const span = Math.max(1, seg.end - seg.start);
    const pad = Math.max(3.5, span * 0.65);
    const winMin = Math.max(0, seg.start - pad);
    const winMax = Math.min(total, Math.max(seg.end + pad, winMin + 10));
    return { winMin, winMax: Math.max(winMin + 2, winMax) };
  }

  function syncSegmentTrackUI(item, seg, curTime) {
    if (!item || !seg) return;
    const { winMin, winMax } = getSegmentWindow(item, seg);
    const range = Math.max(0.1, winMax - winMin);
    const sPct = clamp(((seg.start - winMin) / range) * 100, 0, 100);
    const ePct = clamp(((seg.end - winMin) / range) * 100, 0, 100);
    const pPct = clamp(((curTime - winMin) / range) * 100, 0, 100);

    const fill = item.querySelector('.seg-range-fill');
    const hStart = item.querySelector('.seg-handle-start');
    const hEnd = item.querySelector('.seg-handle-end');
    const playhead = item.querySelector('.seg-playhead');
    const lblMin = item.querySelector('.seg-win-min');
    const lblMax = item.querySelector('.seg-win-max');
    const lblDur = item.querySelector('.seg-win-dur');
    const previewBtn = item.querySelector('.seg-preview-btn');

    if (fill) {
      fill.style.left = `${sPct}%`;
      fill.style.width = `${Math.max(0.5, ePct - sPct)}%`;
    }
    if (hStart) hStart.style.left = `${sPct}%`;
    if (hEnd) hEnd.style.left = `${ePct}%`;
    if (playhead) {
      playhead.style.left = `${pPct}%`;
      playhead.style.opacity = curTime >= winMin && curTime <= winMax ? '1' : '0.25';
    }
    if (lblMin) lblMin.textContent = secText(winMin);
    if (lblMax) lblMax.textContent = secText(winMax);
    if (lblDur) {
      lblDur.textContent = `${secText(seg.start)} → ${secText(seg.end)} (${Math.max(0, seg.end - seg.start).toFixed(2)}s)`;
    }
    if (previewBtn) {
      const isPlayingThis = playing && previewSegId === String(seg.id);
      previewBtn.classList.toggle('playing-seg', isPlayingThis);
      previewBtn.textContent = isPlayingThis ? '❚❚ Dừng thử' : '▶ Phát thử';
    }
  }

  function renderScrubberSegments() {
    const wrap = $('scrubberSegments');
    if (!wrap) return;
    const total = Math.max(1, totalTime());
    wrap.innerHTML = sortedLyrics()
      .map((seg) => {
        const left = clamp((seg.start / total) * 100, 0, 100);
        const width = clamp(((seg.end - seg.start) / total) * 100, 0.4, 100 - left);
        return `<span class="scrubber-seg-mark" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"></span>`;
      })
      .join('');
  }

  function drawWaveform() {
    const canvasEl = $('waveform');
    if (!canvasEl || !pcmBuffer) return;
    const width = Math.max(320, Math.floor(canvasEl.clientWidth || 900));
    const height = 42;
    canvasEl.width = width;
    canvasEl.height = height;
    const waveCtx = canvasEl.getContext('2d');
    const samples = pcmBuffer.getChannelData(0);
    const bins = Math.min(width, 1400);
    waveCtx.clearRect(0, 0, width, height);
    waveCtx.fillStyle = 'rgba(15, 23, 42, .72)';
    waveCtx.fillRect(0, 0, width, height);
    waveCtx.fillStyle = data.accentColor || '#a78bfa';
    for (let i = 0; i < bins; i++) {
      const start = Math.floor((i / bins) * samples.length);
      const end = Math.max(start + 1, Math.floor(((i + 1) / bins) * samples.length));
      let peak = 0;
      for (let j = start; j < end; j += Math.max(1, Math.floor((end - start) / 12))) peak = Math.max(peak, Math.abs(samples[j] || 0));
      const bar = Math.max(1, peak * (height - 6));
      waveCtx.globalAlpha = 0.35 + Math.min(0.6, peak * 1.4);
      waveCtx.fillRect((i / bins) * width, (height - bar) / 2, Math.max(1, width / bins - 0.5), bar);
    }
    waveCtx.globalAlpha = 1;
  }

  // 2026-11-07: Khách hàng yêu cầu phân trang từng đoạn lời thành các nút 1, 2, 3 gọn gàng thay vì hiện tất cả cùng lúc, đồng thời đưa phần chỉnh Timing (Vào / Ở giữa / Ra) vào riêng từng đoạn lời ở cột bên phải; do đó chỉ render đoạn đang chọn (selectedSegId) kèm bộ thanh trượt timingIn, timingMid, timingOut của chính đoạn đó.
  function renderPagination(sorted) {
    const pag = $('lyricPagination');
    if (!pag) return;
    const playingSeg = findActive(time());
    const playingId = playingSeg ? String(playingSeg.id) : null;
    pag.innerHTML = sorted
      .map((seg, idx) => {
        const sid = String(seg.id);
        const isSel = sid === String(selectedSegId);
        const isPlay = sid === playingId;
        return `<button type="button" class="page-btn${isSel ? ' is-selected' : ''}${isPlay ? ' is-playing' : ''}" data-page-id="${sid}" title="Đoạn ${idx + 1}: ${secText(seg.start)} – ${secText(seg.end)}">${idx + 1}</button>`;
      })
      .join('');
  }

  function buildList() {
    const list = $('lyricList');
    list.innerHTML = '';
    const sorted = sortedLyrics();
    $('lyricCount').textContent = `${sorted.length.toString().padStart(2, '0')} đoạn`;

    if (!sorted.length) {
      selectedSegId = null;
      renderPagination([]);
      renderScrubberSegments();
      return;
    }

    if (!selectedSegId || !sorted.some((s) => String(s.id) === String(selectedSegId))) {
      selectedSegId = String(sorted[0].id);
    }

    renderPagination(sorted);
    const selectedPage = $('lyricPagination').querySelector('.is-selected');
    if (selectedPage) $('lyricPagination').scrollTop = selectedPage.offsetTop - $('lyricPagination').offsetTop;
    const curTime = time();
    const idx = sorted.findIndex((s) => String(s.id) === String(selectedSegId));
    const seg = sorted[idx >= 0 ? idx : 0];
    if (seg.text === 'Nhập lời hát ở đây...') seg.text = '';
    const pageNum = (idx >= 0 ? idx : 0) + 1;

    const tIn = Math.max(0.1, Number(seg.timingIn) || 0.75);
    const tMid = Math.max(0, Number(seg.timingMid ?? 1.5));
    const tOut = Math.max(0.1, Number(seg.timingOut) || 0.75);

    const item = document.createElement('div');
    item.className = 'lyric-item';
    item.dataset.id = seg.id;
    item.innerHTML = `<div class="lyric-top"><span class="lyric-index">#${String(pageNum).padStart(2, '0')} / ${String(sorted.length).padStart(2, '0')}</span><span class="lyric-status">${secText(seg.start)} – ${secText(seg.end)}</span><button class="lyric-action" type="button" data-action="duplicate" title="Nhân bản câu này">⧉</button><button class="lyric-action" type="button" data-action="remove" title="Xóa câu này">×</button></div><textarea class="textarea lyric-words" data-field="text" placeholder="Nhập lời hát ở đây...">${escapeHtml(seg.text)}</textarea><div class="seg-timeline-box"><button class="seg-preview-btn" type="button" data-action="playSegment" title="Phát thử đoạn này">▶ Phát thử</button><div class="seg-track-area" tabindex="0"><div class="seg-track" data-role="segTrack"><div class="seg-track-bg"></div><div class="seg-range-fill"></div><div class="seg-playhead"></div><div class="seg-handle seg-handle-start" data-handle="start" title="Mốc bắt đầu"></div><div class="seg-handle seg-handle-end" data-handle="end" title="Mốc kết thúc"></div></div><div class="seg-window-labels"><span class="seg-win-min">00:00.00</span><span class="seg-win-dur"></span><span class="seg-win-max">00:20.00</span></div></div></div><div class="segment-time"><div class="timebox"><label>BẮT ĐẦU</label><div class="time-input-row"><input class="input" data-field="start" value="${secText(seg.start)}" aria-label="Thời gian bắt đầu"><button class="time-capture" type="button" data-action="setStart" title="Lấy mốc hiện tại">⊙</button></div></div><div class="timebox"><label>KẾT THÚC</label><div class="time-input-row"><input class="input" data-field="end" value="${secText(seg.end)}" aria-label="Thời gian kết thúc"><button class="time-capture" type="button" data-action="setEnd" title="Lấy mốc hiện tại">⊙</button></div></div></div><div class="seg-timing-panel"><div class="seg-timing-head"><strong>Nhịp chuyển động #${pageNum}</strong><button type="button" class="seg-sync-all-btn" data-action="syncTimingAll">Áp dụng mọi câu</button></div><div class="seg-timing-grid"><div class="seg-timing-item"><div class="seg-timing-label"><span>↗ Vào</span><b data-val="timingIn">${tIn.toFixed(2)}×</b></div><input class="range" type="range" min="0.1" max="2.5" step="0.05" data-field="timingIn" value="${tIn}" /></div><div class="seg-timing-item"><div class="seg-timing-label"><span>◇ Giữa</span><b data-val="timingMid">${tMid.toFixed(2)}×</b></div><input class="range" type="range" min="0" max="4.0" step="0.05" data-field="timingMid" value="${tMid}" /></div><div class="seg-timing-item"><div class="seg-timing-label"><span>↖ Ra</span><b data-val="timingOut">${tOut.toFixed(2)}×</b></div><input class="range" type="range" min="0.1" max="2.5" step="0.05" data-field="timingOut" value="${tOut}" /></div></div></div><div class="lyric-foot"><label class="lyric-icon-field">Emoji <input class="input" data-field="icon" aria-label="Emoji của câu" placeholder="✨" value="${escapeHtml(seg.icon || '')}" /></label></div>`;
    list.appendChild(item);
    syncSegmentTrackUI(item, seg, curTime);
    renderScrubberSegments();
    activeId = null;
    highlightCurrent();
  }

  function findActive(t) {
    const matching = sortedLyrics().filter((seg) => t >= seg.start && t < seg.end);
    return matching.length ? matching[matching.length - 1] : null;
  }

  function highlightCurrent() {
    const seg = findActive(time());
    const id = seg ? String(seg.id) : null;
    if (id === activeId) return;
    activeId = id;
    document.querySelectorAll('.page-btn').forEach((btn) => {
      btn.classList.toggle('is-playing', btn.dataset.pageId === id);
    });
    document.querySelectorAll('.lyric-item').forEach((e) => {
      const yes = e.dataset.id === id;
      e.classList.toggle('is-active', yes);
      const status = e.querySelector('.lyric-status');
      if (yes) {
        status.textContent = '● ĐANG HIỂN THỊ';
        status.classList.add('active');
      } else {
        const s = data.lyrics.find((z) => String(z.id) === e.dataset.id);
        if (s) {
          status.textContent = secText(s.start) + ' – ' + secText(s.end);
          status.classList.remove('active');
        }
      }
    });
  }

  function updateTransport(t) {
    const duration = totalTime();
    const clamped = clamp(t, 0, duration);
    $('seek').max = duration;
    $('seek').value = clamped;
    $('currentTimeLabel').textContent = secText(t);
    $('durationLabel').textContent = secText(duration);
    if ($('sideSeek')) {
      $('sideSeek').max = duration;
      $('sideSeek').value = clamped;
    }
    if ($('sideCurrentTime')) $('sideCurrentTime').textContent = secText(t);
    if ($('sideDuration')) $('sideDuration').textContent = secText(duration);
    document.querySelectorAll('.lyric-item').forEach((item) => {
      const seg = data.lyrics.find((x) => String(x.id) === item.dataset.id);
      if (seg) syncSegmentTrackUI(item, seg, t);
    });
    highlightCurrent();
  }

  function setPlayingUI() {
    $('playBtn').textContent = playing ? '❚❚' : '▶';
    $('playBtn').setAttribute('aria-label', playing ? 'Tạm dừng' : 'Phát');
    $('overlayPlay').classList.toggle('hidden', playing);
    $('overlayPlay').textContent = playing ? '❚❚' : '▶';
    $('musicBars').classList.toggle('paused', !playing);
    $('previewStatus').textContent = playing ? '● ĐANG PHÁT' : 'LIVE PREVIEW';
    if ($('sidePlayBtn')) $('sidePlayBtn').textContent = playing ? '❚❚ Dừng' : '▶ Phát';
    document.querySelectorAll('.lyric-item').forEach((item) => {
      const seg = data.lyrics.find((x) => String(x.id) === item.dataset.id);
      if (seg) syncSegmentTrackUI(item, seg, time());
    });
  }

  async function play() {
    if (recording()) return;
    if (time() >= totalTime() - 0.05) setTime(0);
    if (pcmReady && pcmBuffer) {
      startPcmSourceAt(pcmOffset);
      playing = true;
    } else if (audioReady) {
      try {
        await audio.play();
        playing = true;
      } catch (e) {
        toast('Trình duyệt không thể phát tệp nhạc này.');
      }
    } else if (ytReady && ytPlayer && typeof ytPlayer.playVideo === 'function') {
      ytPlayer.playVideo();
      playing = true;
    } else {
      playing = true;
    }
    setPlayingUI();
  }

  function pause() {
    if (pcmReady && pcmBuffer) {
      if (playing) {
        pcmOffset = clamp(pcmOffset + (audioContext.currentTime - pcmStartWall), 0, pcmBuffer.duration);
      }
      stopPcmSource();
    }
    if (audioReady) audio.pause();
    if (ytReady && ytPlayer && typeof ytPlayer.pauseVideo === 'function') {
      try {
        ytPlayer.pauseVideo();
      } catch (e) {}
    }
    playing = false;
    previewSegId = null;
    previewSegEnd = null;
    setPlayingUI();
  }

  function togglePlay() {
    playing ? pause() : play();
  }

  function recording() {
    return exportRecorder && exportRecorder.state === 'recording';
  }

  function cleanupYtPlayer() {
    ytReady = false;
    ytDuration = 0;
    if (ytPlayer && typeof ytPlayer.stopVideo === 'function') {
      try {
        ytPlayer.stopVideo();
      } catch (e) {}
    }
    if (ytPlayer && typeof ytPlayer.destroy === 'function') {
      try { ytPlayer.destroy(); } catch (e) {}
    }
    ytPlayer = null;
    const mount = $('ytHiddenMount');
    if (mount) mount.innerHTML = '';
  }

  async function loadAudioBlob(blobOrFile, displayTitle, subLabel, opts = {}) {
    cleanupYtPlayer();
    pause();
    stopPcmSource();
    pcmReady = false;
    pcmBuffer = null;
    audioReady = false;
    activeAudioBlob = blobOrFile;
    if ($('removeAudioBtn')) $('removeAudioBtn').disabled = false;

    if (audioURL) URL.revokeObjectURL(audioURL);
    audioURL = URL.createObjectURL(blobOrFile);

    $('audioName').textContent = displayTitle;
    $('musicTitle').textContent = displayTitle.replace(/\.[^.]+$/, '');
    $('musicSub').textContent = (subLabel || 'Đã đồng bộ với timeline') + ' · Đang nạp RAM cache...';

    if (!opts.skipSave) {
      idbSet('active_audio', {
        blob: blobOrFile,
        displayTitle,
        subLabel: subLabel || 'Đã đồng bộ với timeline',
        ytId: currentYtId,
        ytUrl: $('ytUrlInput') ? $('ytUrlInput').value : ''
      });
    }

    try {
      const ctxAudio = ensureAudioContextSync();
      const arrBuf = await blobOrFile.arrayBuffer();
      const decoded = await ctxAudio.decodeAudioData(arrBuf.slice(0));
      pcmBuffer = decoded;
      pcmReady = true;
      drawWaveform();
      pcmOffset = 0;
      demoTime = 0;
      $('musicSub').textContent = (subLabel || 'Đã đồng bộ với timeline') + ' · RAM Cache 0ms';
      setTime(0);
      updateTransport(0);
      renderScrubberSegments();
      return;
    } catch (decodeErr) {
      // Fallback to HTML5 <audio> if decodeAudioData fails
    }

    audio.src = audioURL;
    audio.load();
    audio.addEventListener(
      'loadedmetadata',
      () => {
        audioReady = true;
        demoTime = 0;
        $('musicSub').textContent = subLabel || 'Đã đồng bộ với timeline';
        setTime(0);
        updateTransport(0);
        renderScrubberSegments();
      },
      { once: true }
    );
    audio.addEventListener(
      'error',
      () => toast('Không đọc được định dạng nhạc này. Hãy thử MP3, M4A hoặc WAV.'),
      { once: true }
    );
  }

  let loadedAudioPath = '';

  function setLoadedAudioPath(file) {
    loadedAudioPath = file?.path || file?.name || '';
    const button = $('copyAudioPathBtn');
    const removeButton = $('removeAudioBtn');
    const hint = $('audioPathHint');
    if (button) button.disabled = !loadedAudioPath;
    if (removeButton) removeButton.disabled = !activeAudioBlob && !audioURL && !ytReady;
    if (hint) hint.textContent = loadedAudioPath
      ? loadedAudioPath
      : 'File từ YouTube không có đường dẫn local';
  }

  async function copyLoadedAudioPath() {
    if (!loadedAudioPath) {
      toast('Chưa có file âm thanh local để copy đường dẫn.');
      return;
    }
    try {
      await navigator.clipboard.writeText(loadedAudioPath);
      toast('Đã copy đường dẫn âm thanh.');
    } catch (e) {
      toast('Không thể copy tự động. Hãy dùng tên file: ' + loadedAudioPath);
    }
  }

  function useAudio(file) {
    if (!file) return;
    currentYtId = null;
    setLoadedAudioPath(file);
    loadAudioBlob(file, file.name, 'File âm thanh từ máy tính');
    toast('Đã nạp bài hát vào bộ nhớ đệm RAM (Phát thử 0ms).');
  }

  async function removeAudio() {
    debugLog('audio:remove:start');
    audioGeneration += 1;
    pause();
    stopPcmSource();
    cleanupYtPlayer();
    activeAudioBlob = null;
    audioReady = false;
    pcmReady = false;
    pcmBuffer = null;
    if (audioURL) URL.revokeObjectURL(audioURL);
    audioURL = null;
    audio.removeAttribute('src');
    audio.load();
    const waveform = $('waveform');
    if (waveform) waveform.getContext('2d').clearRect(0, 0, waveform.width, waveform.height);
    currentYtId = null;
    if ($('ytUrlInput')) $('ytUrlInput').value = '';
    await idbSet('active_audio', null);
    setLoadedAudioPath(null);
    $('audioName').textContent = 'MP3, WAV, M4A';
    $('musicTitle').textContent = 'Chưa có bài hát';
    $('musicSub').textContent = 'Nạp file nhạc hoặc YouTube Audio';
    persist();
    toast('Đã gỡ bài hát hiện tại.');
    debugLog('audio:remove:done');
  }

  async function createNewProject() {
    if (!window.confirm('Tạo dự án mới và xóa lời/lớp chữ hiện tại?')) return;
    data = structuredClone(DEFAULT);
    stickers = [];
    selectedSegId = null;
    selectedStickerId = null;
    activeId = null;
    applyData();
    buildStickerList();
    persist();
    persistStickers();
    toast('Đã tạo dự án mới.');
  }

  async function exportAgentPackage() {
    const button = $('agentPackageBtn');
    const originalText = button?.textContent || 'Gói agent';
    if (button) { button.disabled = true; button.textContent = 'Đang tạo...'; }
    toast('Đang chuẩn bị gói agent...');
    const packageYtId = currentYtId || extractYoutubeId($('ytUrlInput')?.value || '');
    debugLog('agent-package:start', { hasRamAudio: Boolean(activeAudioBlob), ytId: packageYtId });
    try {
      const cached = activeAudioBlob ? null : await idbGet('active_audio');
      let audioBlob = activeAudioBlob || cached?.blob;
      if (!audioBlob && packageYtId) {
        debugLog('agent-package:fetch-youtube', { ytId: packageYtId });
        const audioResponse = await fetch(`${LOCAL_API_BASE}/api/youtube?url=${encodeURIComponent(packageYtId)}`);
        debugLog('agent-package:youtube-response', { status: audioResponse.status });
        if (audioResponse.ok) audioBlob = await audioResponse.blob();
      }
      if (!audioBlob) throw new Error('no audio');
      debugLog('agent-package:audio-ready', { bytes: audioBlob.size, type: audioBlob.type });
      const displayName = cached?.displayTitle || $('audioName')?.textContent || 'audio.m4a';
      const audioName = /\.[a-z0-9]+$/i.test(displayName) ? displayName : 'audio.m4a';
      const songTitle = ($('musicTitle')?.textContent || displayName || 'song').replace(/\.[^.]+$/, '').trim();
      const prompt = `Process the FULL attached audio from 00:00 to the exact end. Do not analyze only a sample, preview, chorus, or one segment. Read project.json completely and preserve every existing project field. Use the existing lyrics timing as an anchor and change a timing only when the audio clearly proves it is wrong. Re-align the entire lyrics array against the complete audio: update lyrics[].start and lyrics[].end for every line, and correct lyrics[].text only when clearly audible. Detect the real vocal onset for every line. Instrumental music must remain empty: never place a lyric during an instrumental intro, instrumental break, beat-only gap, or outro. The first lyric must begin only when the first vocal syllable is actually audible; do not move it to 00:00. Keep every original silent/instrumental gap between lines. Never force lyrics to cover the whole duration, never invent words, never shift a line earlier just to fill a gap, and never create extra lyric segments. Keep all song sections, repeated verses, chorus lines, intro, outro, and the complete duration. Do not return a partial JSON or a one-line example. Preserve beatEffect, textOverlays, version, songTitle, and every non-lyrics field. Save the complete result as project-corrected.json in UTF-8. Verify the output parses with json.loads(), contains the same complete lyrics array, and keeps the complete beatEffect.beats array. The song title is: ${songTitle}`;
      const projectJson = JSON.stringify({ ...data, version: data.version || 3, songTitle }, null, 2);
      const audioBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = reject;
        reader.readAsDataURL(audioBlob);
      });
      try {
        const folderResponse = await fetch(`${LOCAL_API_BASE}/api/agent-folder`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectJson, prompt, audioName, audioBase64 })
        });
        if (folderResponse.ok) {
          const folderResult = await folderResponse.json();
          debugLog('agent-package:folder-created', folderResult);
          toast(`Đã tạo folder agent: ${folderResult.folder}`);
          return;
        }
      } catch (folderError) {
        debugLog('agent-package:folder-error', { message: folderError.message });
      }
      const projectBlob = new Blob([projectJson], { type: 'application/json' });
      const downloadSeparate = () => {
        download(projectBlob, 'project.json');
        setTimeout(() => download(new Blob([prompt], { type: 'text/plain' }), 'PROMPT.txt'), 250);
        setTimeout(() => download(audioBlob, audioName), 500);
        debugLog('agent-package:separate-downloads', { audioBytes: audioBlob.size });
        toast('Đã tải riêng project.json, PROMPT.txt và audio.');
      };
      downloadSeparate();
    } catch (err) {
      console.error('Agent package error', err);
      debugLog('agent-package:error', { message: err.message });
      toast(err.message === 'no audio' ? 'Hãy nạp file âm thanh trước.' : 'Không tạo được gói agent. Hãy khởi động lại app.');
    } finally {
      if (button) { button.disabled = false; button.textContent = originalText; }
    }
  }

  async function refreshLibrary() {
    const list = $('libraryList');
    if (!list) return;
    list.textContent = 'Đang tải...';
    try {
      const files = await fetch('/api/library').then((r) => r.json());
      list.innerHTML = files.length ? files.map((file) => `<label class="library-row"><input type="checkbox" data-library-name="${escapeHtml(file.name)}" /><span>${escapeHtml(file.name)}</span><a href="${file.url}" target="_blank" rel="noreferrer">Mở</a>${file.name.toLowerCase().endsWith('.json') ? `<button type="button" class="btn btn-small" data-library-open="${escapeHtml(file.url)}">Nạp</button>` : ''}</label>`).join('') : '<small>Chưa có phiên bản trong exports.</small>';
      list.querySelectorAll('[data-library-open]').forEach((button) => button.addEventListener('click', async () => {
        const obj = await fetch(button.dataset.libraryOpen).then((r) => r.json());
        const file = new File([JSON.stringify(obj)], button.dataset.libraryOpen.split('/').pop(), { type: 'application/json' });
        const transfer = new DataTransfer(); transfer.items.add(file); $('projectInput').files = transfer.files; $('projectInput').dispatchEvent(new Event('change', { bubbles: true }));
        $('libraryDialog')?.close();
      }));
    } catch (e) { list.textContent = 'Không tải được thư viện phiên bản.'; }
  }

  async function cleanupLibrary() {
    const names = [...document.querySelectorAll('[data-library-name]:checked')].map((x) => x.dataset.libraryName);
    if (!names.length) return toast('Chọn mục cần dọn trước.');
    if (!window.confirm(`Xóa ${names.length} mục đã chọn khỏi thư mục exports?`)) return;
    await fetch('/api/library/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ names }) });
    await refreshLibrary();
    toast('Đã dọn các mục được chọn.');
  }

  function useImage(file, opts = {}) {
    if (!file) return;
    const name = opts.name || file.name || 'background.png';
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      if (imageURL) URL.revokeObjectURL(imageURL);
      imageURL = url;
      background = img;
      $('imageName').textContent = name;
      if (!opts.skipSave) {
        idbSet('active_bg', { blob: file, name });
      }
      draw(time());
      if (!opts.silent) toast('Đã cập nhật & lưu ảnh nền.');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      if (!opts.silent) toast('Không thể mở tệp ảnh này.');
    };
    img.src = url;
  }

  // --- YouTube Link Quick Audio Import ---
  function extractYoutubeId(input) {
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

  function loadYoutubeIframeFallback(videoId, title, author) {
    return new Promise((resolve, reject) => {
      const initPlayer = () => {
        if (ytPlayer && typeof ytPlayer.destroy === 'function') {
          try {
            ytPlayer.destroy();
          } catch (e) {}
        }
        const mount = $('ytHiddenMount');
        mount.innerHTML = '<div id="ytInnerPlayer"></div>';
        ytPlayer = new window.YT.Player('ytInnerPlayer', {
          height: '1',
          width: '1',
          videoId,
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            rel: 0,
            origin: location.origin !== 'null' ? location.origin : undefined
          },
          events: {
            onReady: (ev) => {
              audioReady = false;
              ytReady = true;
              ytDuration = Number(ev.target.getDuration()) || 210;
              $('audioName').textContent = `YouTube: ${title}`;
              $('musicTitle').textContent = title;
              $('musicSub').textContent = `${author} · Phát trực tiếp từ YouTube`;
              setTime(0);
              updateTransport(0);
              resolve();
            },
            onStateChange: (ev) => {
              if (ev.data === window.YT.PlayerState.PLAYING) {
                playing = true;
                ytDuration = Number(ytPlayer.getDuration()) || ytDuration;
                setPlayingUI();
              } else if (
                ev.data === window.YT.PlayerState.PAUSED ||
                ev.data === window.YT.PlayerState.ENDED
              ) {
                playing = false;
                setPlayingUI();
              }
            },
            onError: () => reject(new Error('YouTube embed blocked'))
          }
        });
      };

      if (window.YT && window.YT.Player) {
        initPlayer();
      } else {
        window.onYouTubeIframeAPIReady = initPlayer;
        if (!document.getElementById('ytIframeApiScript')) {
          const s = document.createElement('script');
          s.id = 'ytIframeApiScript';
          s.src = 'https://www.youtube.com/iframe_api';
          s.onerror = () => reject(new Error('Failed to load YouTube API'));
          document.head.appendChild(s);
        }
      }
    });
  }

  // 2026-11-07: Khách hàng muốn dán link YouTube để lấy âm thanh nhanh và có cache local không bị lag khi bấm Phát thử; kiểm tra cache IndexedDB (yt_blob_<videoId>) trước tiên để nạp tức thì, nếu chưa có mới tải qua server local rồi lưu vào IndexedDB + giải mã AudioBuffer RAM.
  async function importYoutubeAudio(rawUrl) {
    const videoId = extractYoutubeId(rawUrl);
    if (!videoId) {
      toast('Link YouTube không hợp lệ. Hãy dán link dạng youtube.com/watch?v=... hoặc youtu.be/...');
      return;
    }
    debugLog('youtube:start', { videoId });

    currentYtId = videoId;
    activeAudioBlob = null;
    pause();
    stopPcmSource();
    audioReady = false;
    pcmReady = false;
    pcmBuffer = null;
    if (audioURL) URL.revokeObjectURL(audioURL);
    audioURL = null;
    audio.removeAttribute('src');
    audio.load();
    setLoadedAudioPath(null);
    persist();
    const btn = $('ytImportBtn');
    const btnText = $('ytBtnText');
    btn.disabled = true;
    btnText.textContent = 'Đang nạp...';

    let metaTitle = `YouTube (${videoId})`;
    let metaAuthor = 'YouTube Music';

    const previewCard = $('ytPreviewCard');
    const thumbImg = $('ytThumbImg');
    thumbImg.src = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    $('ytTrackTitle').textContent = 'Đang kiểm tra bộ nhớ đệm...';
    $('ytTrackAuthor').textContent = `ID: ${videoId}`;
    previewCard.classList.remove('hidden');

    try {
      // 1. Check browser IndexedDB local cache first
      const cachedYt = await idbGet(`yt_blob_${videoId}`);
      if (cachedYt && cachedYt.blob) {
        debugLog('youtube:cache-hit', { videoId, bytes: cachedYt.blob.size });
        metaTitle = cachedYt.title || metaTitle;
        metaAuthor = cachedYt.author || metaAuthor;
        $('ytTrackTitle').textContent = metaTitle;
        $('ytTrackAuthor').textContent = `${metaAuthor} · Đã nạp từ Cache Local`;
        await loadAudioBlob(cachedYt.blob, `${metaTitle}.m4a`, `YouTube · ${metaAuthor}`);
        toast(`Đã nạp tức thì từ Cache Local: ${metaTitle}`);
        return;
      }

      // 2. Fetch oEmbed metadata in parallel if not cached
      fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((oembed) => {
          if (oembed && oembed.title) {
            metaTitle = oembed.title;
            metaAuthor = oembed.author_name || metaAuthor;
            $('ytTrackTitle').textContent = metaTitle;
            $('ytTrackAuthor').textContent = metaAuthor;
          }
        })
        .catch(() => {});

      // 3. Fetch real audio stream from local bridge server (which also caches in .studio_cache)
      const apiEndpoint = `${LOCAL_API_BASE}/api/youtube?url=${encodeURIComponent(videoId)}`;
      const res = await fetch(apiEndpoint);
      debugLog('youtube:server-response', { videoId, status: res.status });
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const headerTitle = res.headers.get('X-Video-Title');
      const headerAuthor = res.headers.get('X-Video-Author');
      if (headerTitle) metaTitle = decodeURIComponent(headerTitle);
      if (headerAuthor) metaAuthor = decodeURIComponent(headerAuthor);

      const blob = await res.blob();
      debugLog('youtube:blob-ready', { videoId, bytes: blob.size, type: blob.type });
      await idbSet(`yt_blob_${videoId}`, {
        videoId,
        blob,
        title: metaTitle,
        author: metaAuthor,
        savedAt: Date.now()
      });

      $('ytTrackTitle').textContent = metaTitle;
      $('ytTrackAuthor').textContent = `${metaAuthor} · Đã lưu Cache Local`;

      await loadAudioBlob(blob, `${metaTitle}.m4a`, `YouTube · ${metaAuthor}`);
      toast(`Đã tải & lưu Cache Local: ${metaTitle}`);
    } catch (err) {
      debugLog('youtube:error', { videoId, message: err.message });
      try {
        await loadYoutubeIframeFallback(videoId, metaTitle, metaAuthor);
        $('ytTrackTitle').textContent = metaTitle;
        $('ytTrackAuthor').textContent = `${metaAuthor} · Chế độ phát trực tuyến`;
        toast('Đã kết nối nhạc YouTube trực tuyến.');
      } catch (fallbackErr) {
        toast('Không thể lấy nhạc từ link này.');
      }
    } finally {
      btn.disabled = false;
      btnText.textContent = 'Lấy nhạc';
    }
  }

  function applyYoutubeThumbnailAsBackground() {
    if (!currentYtId) return;
    const hiRes = `https://i.ytimg.com/vi/${currentYtId}/maxresdefault.jpg`;
    const stdRes = `https://i.ytimg.com/vi/${currentYtId}/hqdefault.jpg`;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (img.width <= 120 && img.src !== stdRes) {
        img.src = stdRes;
        return;
      }
      background = img;
      $('imageName').textContent = `YouTube Thumbnail (${currentYtId})`;
      draw(time());
      toast('Đã đặt ảnh bìa YouTube làm hình nền!');
    };
    img.onerror = () => {
      if (img.src !== stdRes) {
        img.src = stdRes;
      } else {
        toast('Không tải được ảnh bìa của video này.');
      }
    };
    img.src = hiRes;
  }

  // --- Cosmic Galaxy Canvas Renderer ---
  let bgScaledCanvas = null, bgScaledSource = null;
  function getScaledBackground() {
    if (!background) return null;
    if (bgScaledCanvas && bgScaledSource === background) return bgScaledCanvas;
    bgScaledSource = background;
    const c = document.createElement('canvas');
    c.width = EXPORT_W;
    c.height = EXPORT_H;
    const g = c.getContext('2d');
    const s = Math.max(EXPORT_W / background.width, EXPORT_H / background.height);
    const w = background.width * s, h = background.height * s;
    g.drawImage(background, (EXPORT_W - w) / 2, (EXPORT_H - h) / 2, w, h);
    bgScaledCanvas = c;
    return bgScaledCanvas;
  }

  function drawWaterMotion(t, x, y, width, height) {
    if (!data.waterMotion?.enabled || !background) return;
    const srcCanvas = getScaledBackground() || background;
    const top = Math.floor(y + height * clamp(Number(data.waterMotion.horizon) || .805, .55, .95));
    const amount = Number(data.waterMotion.amount) || 1;
    const phase = t * Math.PI / 4;
    const rowStep = recording() ? 10 : 6;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, W, H - top);
    ctx.clip();
    for (let row = top; row < H; row += rowStep) {
      const depth = clamp((row - top) / (H - top));
      const sourceY = ((row - y) / height) * srcCanvas.height;
      const sourceH = Math.min(srcCanvas.height - sourceY, ((rowStep + 1) / height) * srcCanvas.height);
      if (sourceH <= 0) continue;
      const shift = (Math.sin(phase + depth * 22) * 5 + Math.sin(phase * 2 - depth * 13) * 2) * depth * amount;
      ctx.drawImage(srcCanvas, 0, sourceY, srcCanvas.width, sourceH, x + shift, row, width, rowStep + 1);
    }
    ctx.restore();
  }

  function drawSettingSun(t,x,y,width,height) {
    if (!data.sunsetSun?.enabled || !data.intro?.enabled) return;
    const end=Number(data.sunsetSun.end)||28.8;
    if(t<0 || t>=end)return;
    const progress=smooth(t/end);
    const startY=Number(data.sunsetSun.startY)||.665;
    const endY=Number(data.sunsetSun.endY)||.777;
    const cx=x+width*.628, cy=y+height*(startY+(endY-startY)*progress);
    const radius=width*.0145;
    ctx.save();ctx.beginPath();ctx.rect(0,0,W,y+height*(Number(data.sunsetSun.horizon)||.762));ctx.clip();
    ctx.globalAlpha=smooth((1-progress)/.28);
    const halo=ctx.createRadialGradient(cx,cy,radius*.5,cx,cy,radius*4);
    halo.addColorStop(0,'rgba(255,187,151,.32)');halo.addColorStop(1,'rgba(255,140,170,0)');
    ctx.fillStyle=halo;ctx.fillRect(cx-radius*4,cy-radius*4,radius*8,radius*8);
    const disk=ctx.createLinearGradient(0,cy-radius,0,cy+radius);
    disk.addColorStop(0,'#fff1bc');disk.addColorStop(1,'#ffbc87');
    ctx.fillStyle=disk;ctx.beginPath();ctx.arc(cx,cy,radius,0,Math.PI*2);ctx.fill();
    ctx.restore();
  }

  // 2026-11-15: Khách hàng phản hồi nền bị tĩnh quá chán nhưng trước đó nếu giật theo beat lại khó chịu; nên giữ chuyển động trôi chậm điện ảnh rất êm (zoom 1.02 + 0.004*sin) không bị giật cục theo trống mà khung hình vẫn có sức sống.
  function drawBackground(t) {
    if (background) {
      const srcCanvas = getScaledBackground() || background;
      const zoom = 1.02 + 0.004 * Math.sin(t * 0.14);
      const w = W * zoom,
        h = H * zoom;
      const x = (W - w) / 2 + Math.sin(t * 0.11) * 4;
      const y = (H - h) / 2 + Math.cos(t * 0.09) * 2.5;
      ctx.drawImage(srcCanvas, x, y, w, h);
      drawWaterMotion(t,x,y,w,h);
      drawSettingSun(t,x,y,w,h);
    } else {
      // Deep Space Galaxy Nebula Default Scene
      const sky = ctx.createLinearGradient(0, 0, W * 0.35, H);
      sky.addColorStop(0, '#040510');
      sky.addColorStop(0.38, '#0c1029');
      sky.addColorStop(0.72, '#1c123c');
      sky.addColorStop(1, '#070919');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      // Nebula Cloud 1 (Violet-Magenta Core)
      const neb1X = W * 0.32 + Math.sin(t * 0.12) * 35;
      const neb1Y = H * 0.36 + Math.cos(t * 0.1) * 20;
      const neb1 = ctx.createRadialGradient(neb1X, neb1Y, 10, neb1X, neb1Y, W * 0.45);
      neb1.addColorStop(0, 'rgba(168, 85, 247, 0.32)');
      neb1.addColorStop(0.45, 'rgba(219, 39, 119, 0.14)');
      neb1.addColorStop(1, 'rgba(15, 23, 42, 0)');
      ctx.fillStyle = neb1;
      ctx.fillRect(0, 0, W, H);

      // Nebula Cloud 2 (Starlight Cyan-Indigo)
      const neb2X = W * 0.72 + Math.cos(t * 0.14) * 40;
      const neb2Y = H * 0.48 + Math.sin(t * 0.11) * 24;
      const neb2 = ctx.createRadialGradient(neb2X, neb2Y, 10, neb2X, neb2Y, W * 0.42);
      neb2.addColorStop(0, 'rgba(56, 189, 248, 0.25)');
      neb2.addColorStop(0.5, 'rgba(99, 102, 241, 0.14)');
      neb2.addColorStop(1, 'rgba(15, 23, 42, 0)');
      ctx.fillStyle = neb2;
      ctx.fillRect(0, 0, W, H);

      // Background Static Twinkling Stars
      for (let i = 0; i < 95; i++) {
        const sx = particles[i].x * W;
        const sy = particles[i].y * H * 0.85;
        const twinkle = 0.25 + 0.75 * Math.pow(Math.sin(t * (1.2 + particles[i].v) + particles[i].phase), 2);
        ctx.globalAlpha = twinkle * 0.75;
        ctx.fillStyle = i % 3 === 0 ? '#bae6fd' : i % 3 === 1 ? '#e9d5ff' : '#ffffff';
        ctx.beginPath();
        ctx.arc(sx, sy, 0.8 + particles[i].z * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Distant Cosmic Horizon Silhouette
      let g = ctx.createLinearGradient(0, H * 0.72, 0, H);
      g.addColorStop(0, 'rgba(30, 27, 75, 0.65)');
      g.addColorStop(1, '#050714');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, H * 0.82);
      ctx.bezierCurveTo(W * 0.18, H * 0.73, W * 0.36, H * 0.84, W * 0.55, H * 0.77);
      ctx.bezierCurveTo(W * 0.74, H * 0.71, W * 0.88, H * 0.81, W, H * 0.74);
      ctx.lineTo(W, H);
      ctx.lineTo(0, H);
      ctx.fill();
    }

    ctx.fillStyle = `rgba(4, 6, 18, ${Number(data.dim) / 100})`;
    ctx.fillRect(0, 0, W, H);
    const vignette = ctx.createRadialGradient(W * 0.5, H * 0.45, H * 0.08, W * 0.5, H * 0.45, H * 0.85);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, data.backgroundStyle==='illustrated' ? 'rgba(4,5,16,.12)' : 'rgba(4,5,16,.65)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }

  function drawWeather(t) {
    const weather = data.weather;
    if (weather === 'none') return;
    const count = Math.floor((particles.length * data.density) / 100);
    if (!count) return;

    if (weather === 'galaxy') {
      const palette = ['#ffffff', '#7dd3fc', '#c4b5fd', '#f5d0fe'];
      for (let i = 0; i < count; i++) {
        const p = particles[i];
        const px = mod(p.x * W + t * (8 + 22 * p.z) + Math.sin(t * 0.4 + p.phase) * 26, W);
        const py = mod(p.y * H - t * (4 + 14 * p.v) + Math.cos(t * 0.35 + p.phase) * 18, H);
        const pulse = 0.35 + 0.65 * Math.sin(t * (1.5 + p.v * 1.5) + p.phase);
        const r = 1.0 + 2.8 * p.z;
        ctx.globalAlpha = (0.18 + 0.65 * p.z) * Math.max(0.15, pulse);
        ctx.fillStyle = palette[p.hue];
        ctx.shadowBlur = 10 * p.z;
        ctx.shadowColor = palette[p.hue];
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      // Periodic Shooting Star across the Galaxy
      const cycle = (t * 0.38) % 1;
      if (cycle < 0.28) {
        const p = cycle / 0.28;
        const sx = W * 0.82 - p * W * 0.55;
        const sy = H * 0.12 + p * H * 0.42;
        const tailX = sx + 110;
        const tailY = sy - 75;
        const grad = ctx.createLinearGradient(sx, sy, tailX, tailY);
        grad.addColorStop(0, `rgba(255, 255, 255, ${Math.sin(p * Math.PI)})`);
        grad.addColorStop(0.4, `rgba(125, 211, 252, ${0.5 * Math.sin(p * Math.PI)})`);
        grad.addColorStop(1, 'rgba(125, 211, 252, 0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else if (weather === 'sun') {
      const x = W * 0.8 + Math.sin(t * 0.1) * 28,
        y = H * 0.2;
      const rg = ctx.createRadialGradient(x, y, 0, x, y, W * 0.55);
      rg.addColorStop(0, 'rgba(255,226,163,.19)');
      rg.addColorStop(0.14, 'rgba(255,208,150,.10)');
      rg.addColorStop(1, 'rgba(255,208,150,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < count; i++) {
        const p = particles[i];
        const px = mod(p.x * W + Math.sin(t * 0.21 + p.phase) * 28, W),
          py = mod(p.y * H + t * (5 + 10 * p.v), H);
        const r = 1.2 + 3.2 * p.z;
        ctx.globalAlpha = (0.12 + 0.45 * p.z) * (0.65 + 0.35 * Math.sin(t * 1.7 + p.phase));
        ctx.fillStyle = '#ffefcf';
        ctx.beginPath();
        ctx.arc(px, py, r, 0, 6.29);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (weather === 'snow') {
      for (let i = 0; i < count; i++) {
        const p = particles[i],
          v = 24 + 65 * p.z;
        const px = mod(p.x * W + Math.sin(t * (0.5 + p.v * 0.5) + p.phase) * (14 + 25 * p.z), W),
          py = mod(p.y * H + t * v, H);
        ctx.globalAlpha = 0.3 + 0.7 * p.z;
        ctx.fillStyle = '#f4f9ff';
        ctx.shadowBlur = 8 * p.z;
        ctx.shadowColor = '#e7f5ff';
        ctx.beginPath();
        ctx.arc(px, py, 1.4 + 3.8 * p.z, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    } else if (weather === 'rain') {
      ctx.strokeStyle = '#d4e5ff';
      ctx.lineWidth = 1.3;
      for (let i = 0; i < count; i++) {
        const p = particles[i];
        const px = mod(p.x * W - t * (32 + 15 * p.z), W),
          py = mod(p.y * H + t * (260 + 290 * p.z), H);
        ctx.globalAlpha = 0.11 + 0.33 * p.z;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - 11 - 13 * p.z, py + 20 + 35 * p.z);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else if (weather === 'petal') {
      for (let i = 0; i < count; i++) {
        const p = particles[i];
        const px = mod(p.x * W + t * (12 + 35 * p.z) + Math.sin(t * 0.9 + p.phase) * 29, W + 100) - 50,
          py = mod(p.y * H + t * (22 + 65 * p.z), H + 60) - 30;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(t * (0.4 + p.v * 0.9) + p.phase);
        ctx.scale(0.8 + p.z * 0.55, 0.8 + p.z * 0.55);
        ctx.globalAlpha = 0.5 + 0.42 * p.z;
        ctx.fillStyle = i % 4 === 0 ? '#ffe9ed' : '#ffc9d5';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(-11, -18, -23, -11, -15, 4);
        ctx.bezierCurveTo(-8, 13, -3, 12, 0, 0);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  // 2026-11-16: Khách hàng phản hồi tựa bài "ĐẾN KHI NÀO" bị lỗi font (chữ Đ, N, KHI, NÀO rơi vào Arial Black còn chữ Ế rơi vào Times New Roman); trước đó dùng font-weight 800 với sans-serif/Arial Narrow khi Oswald chỉ hỗ trợ tối đa weight 700 và sunsetRemixArtwork không được xóa cache sau khi webFont tải xong, nên đổi fallback sang Be Vietnam Pro, dùng đúng weight 700 cho Oswald và chỉ khóa cache khi font tiếng Việt đã sẵn sàng.
  function fontFamily() {
    if(data.font==='poetic') return "'Lora',Georgia,serif";
    if (data.font === 'oswald') return `'Oswald','Be Vietnam Pro','Segoe UI',Arial,sans-serif`;
    if (data.font === 'elegant') return `'Playfair Display',Georgia,serif`;
    if (data.font === 'modern') return `'DM Sans','Be Vietnam Pro',sans-serif`;
    return `'Be Vietnam Pro','Segoe UI',Arial,sans-serif`;
  }

  function fontWeight() {
    if(data.font==='poetic') return '500';
    return data.font === 'elegant' || data.font === 'oswald' ? '700' : '800';
  }

  function isCanvasFontReady(fontSpec, sampleText) {
    if (!document.fonts || typeof document.fonts.check !== 'function') return true;
    try {
      const oswaldFaces = [...document.fonts].filter(
        (f) => f.family.replace(/["']/g, '').toLowerCase() === 'oswald' && String(f.weight) === '700'
      );
      if (!oswaldFaces.length) return false;
      const loadedCount = oswaldFaces.filter((f) => f.status === 'loaded').length;
      if (loadedCount < 2) return false;
      return document.fonts.check(fontSpec, sampleText || 'ĐẾN KHI NÀO');
    } catch (e) {
      return true;
    }
  }

  const lyricArtwork = new Map();
  // 2026-11-15: Khách hàng phản hồi cỡ chữ quá nhỏ, thanh kéo cỡ chữ không ăn trên 54px và gõ sửa lời ở cột phải không cập nhật lên màn hình; trước đó requestedSize bị khóa Math.min(..., 54) và wordLayout chỉ lấy chữ cũ trong seg.words mà bỏ qua seg.text mới gõ, nên bỏ giới hạn 54px để nhận đúng data.fontSize và luôn tách từ trực tiếp từ parts.text kết hợp nội suy thời gian tự động.
  function createLyricArtwork(seg) {
    const rawIcon = seg.icon || seg.tag || '';
    const parts = NebulaMotion.textAndIcons(seg.text, rawIcon);
    const resolvedIcon = parts.icon || rawIcon;
    const label = data.font === 'oswald' ? parts.text.toLocaleUpperCase('vi-VN') : parts.text;
    const requestedSize = clamp(Number(data.fontSize) || 76, 28, 130);
    const fontReady = isCanvasFontReady(`${fontWeight()} ${requestedSize}px ${fontFamily()}`, label || 'ĐẾN');
    const wordsSignature = Array.isArray(seg.words) && seg.words.length ? seg.words.map(w => `${w.word ?? w.w ?? ''}_${w.start ?? w.t ?? 0}_${w.end ?? 0}`).join('|') : '';
    const key = JSON.stringify([seg.text, label, resolvedIcon, data.font, data.fontSize, data.textColor, data.accentColor, data.glow, wordsSignature, fontReady]);
    if (lyricArtwork.has(key)) return lyricArtwork.get(key);

    const maxWidth = W * 0.92;
    const gap = resolvedIcon && label ? requestedSize * 0.26 : 0;
    ctx.font = `${fontWeight()} ${requestedSize}px ${fontFamily()}`;
    const measured = ctx.measureText(label).width;
    ctx.font = `${requestedSize * 0.76}px "Segoe UI Emoji",sans-serif`;
    const iconMeasured = resolvedIcon ? ctx.measureText(resolvedIcon).width : 0;
    const size = requestedSize * Math.min(1, maxWidth / Math.max(1, measured + gap + iconMeasured));
    const ratio = size / requestedSize;
    const textWidth = measured * ratio, iconWidth = iconMeasured * ratio, spacing = gap * ratio;
    const totalWidth = textWidth + spacing + iconWidth;
    const pad = 40, height = Math.ceil(size * 2.1 + pad * 2);

    let wordLayout = null;
    const liveTokens = parts.text.trim() ? parts.text.trim().split(/\s+/) : [];
    if (liveTokens.length > 0) {
      ctx.font = `${fontWeight()} ${size}px ${fontFamily()}`;
      const spaceW = ctx.measureText(' ').width;
      let curX = 0;
      const validEntries = [];
      const hasMatchingWords = Array.isArray(seg.words) && seg.words.length === liveTokens.length;
      const segDur = Math.max(0.2, (Number(seg.end) || 0) - (Number(seg.start) || 0));

      for (let i = 0; i < liveTokens.length; i++) {
        const raw = liveTokens[i];
        const wordText = data.font === 'oswald' ? String(raw).toLocaleUpperCase('vi-VN') : String(raw);
        if (!wordText.trim()) continue;
        const wWidth = ctx.measureText(wordText).width;
        let wStart, wEnd;
        if (hasMatchingWords) {
          const w = seg.words[i];
          wStart = Number(w.start ?? w.t ?? seg.start);
          wEnd = Number(w.end ?? (i + 1 < seg.words.length ? (seg.words[i + 1].start ?? seg.words[i + 1].t) : seg.end));
        } else if (Array.isArray(seg.words) && i < seg.words.length) {
          const w = seg.words[i];
          wStart = Number(w.start ?? w.t ?? (seg.start + (i / liveTokens.length) * segDur));
          wEnd = Number(w.end ?? (seg.start + ((i + 1) / liveTokens.length) * segDur));
        } else {
          wStart = Number(seg.start) + (i / liveTokens.length) * segDur;
          wEnd = Number(seg.start) + ((i + 1) / liveTokens.length) * segDur;
        }
        validEntries.push({
          text: wordText,
          start: wStart,
          end: Math.max(wStart + 0.08, wEnd),
          x: curX,
          width: wWidth
        });
        curX += wWidth + spaceW;
      }
      if (validEntries.length > 0) {
        wordLayout = validEntries;
        const totalWordsW = curX > 0 ? curX - spaceW : 0;
        for (const w of wordLayout) {
          w.x -= totalWordsW / 2;
        }
      }
    }

    function raster(text, width, icon) {
      if (!text) return null;
      const layer = document.createElement('canvas');
      // Cache a sharper source so gentle zoom does not blur the glyph edges.
      const resolution=1.5;
      layer.displayWidth=Math.ceil(width+pad*2); layer.displayHeight=height;
      layer.width=Math.ceil(layer.displayWidth*resolution); layer.height=Math.ceil(height*resolution);
      const g = layer.getContext('2d');
      g.scale(resolution,resolution);
      g.font = icon ? `${size * 0.76}px "Segoe UI Emoji",sans-serif` : `${fontWeight()} ${size}px ${fontFamily()}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = data.textColor || '#fff5fa';
      g.shadowColor = '#1d0e30'; g.shadowBlur = 5*resolution; g.shadowOffsetY = 2*resolution;
      g.fillText(text, layer.displayWidth/2, height/2);
      if (!icon) {
        g.shadowOffsetY = 0; g.shadowColor = data.accentColor || '#f2a6d5';
        g.shadowBlur = Number(data.glow) * 0.18*resolution;
        g.fillText(text, layer.displayWidth/2, height/2);
      }
      return layer;
    }
    const art = {label, icon:resolvedIcon, size, totalWidth, textWidth, iconWidth, spacing,
      text:raster(label, textWidth, false), symbol:raster(resolvedIcon, iconWidth, true), wordLayout};
    if (lyricArtwork.size > 24) lyricArtwork.clear();
    if (isCanvasFontReady(`${fontWeight()} ${Math.round(size)}px ${fontFamily()}`, label || 'ĐẾN')) {
      lyricArtwork.set(key, art);
    }
    return art;
  }

  function renderLyricSegment(seg, prevSeg, nextSeg, t) {
    // Reject inactive cues before measuring or rasterizing any text.
    const activeMode = seg.songPart === 2 && VALID_MODES.includes(seg.mode)
      ? seg.mode
      : VALID_MODES.includes(data.lyricMode)
      ? data.lyricMode
      : (seg.mode || 'queue');
    const dir = seg.songPart === 2 ? 'down' : data.lyricDirection;
    const motion = NebulaMotion.state({ ...seg, mode: activeMode }, t, NebulaMotion.beatBreath(data.beatEffect,t), dir);
    if (!motion) return null;
    const art = createLyricArtwork(seg);
    return {...motion, art, lines:[art.label], size:art.size, lineHeight:art.size*1.4, activeNow:true, priority:100};
  }

  // Beat envelopes use the audio timeline, so preview, seeking and export agree.
  function normalizeBeatEffect(value) {
    if (!value || typeof value !== 'object') return null;
    const raw = value.beats || value.beatTrack || value.events || [];
    if (!Array.isArray(raw)) return null;
    const beats=raw.slice(0,10000).filter(b=>b && typeof b==='object').map(b=>({
      time:Number(b.time ?? b.t ?? b.timestamp ?? b.at),
      strength:clamp(Number(b.strength ?? b.energy ?? b.amplitude) || 0.5,0,1)
    })).filter(b=>Number.isFinite(b.time) && b.time>=0).sort((a,b)=>a.time-b.time);
    if (!beats.length) return null;
    const rawSpectrum=value.spectrum;
    let spectrum=null;
    if (rawSpectrum && Number.isInteger(rawSpectrum.bands) && rawSpectrum.bands>0 && rawSpectrum.bands<=32 && Array.isArray(rawSpectrum.frames)) {
      const bands=rawSpectrum.bands, fps=Number(rawSpectrum.fps);
      const frames=rawSpectrum.frames.slice(0,20000);
      if (fps>0 && fps<=60 && frames.every(frame=>Array.isArray(frame) && frame.length===bands)) {
        spectrum={fps,bands,frames:frames.map(frame=>frame.map(v=>clamp(Number(v)||0,0,255)))};
      }
    }
    return {enabled:value.enabled!==false,amount:clamp(Number.isFinite(Number(value.amount))?Number(value.amount):.8,0,1),
      bpm:Number(value.bpm ?? value.tempo)||0,sourceVideoId:String(value.sourceVideoId||''),beats,spectrum};
  }

  function beatPulse(t) {
    const effect = data.beatEffect;
    if (!effect?.enabled || !effect.beats?.length) return 0;
    const beats = effect.beats;
    let lo = 0, hi = beats.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (beats[mid].time <= t) lo = mid + 1; else hi = mid;
    }
    if (!lo) return 0;
    const beat = beats[lo - 1];
    const elapsed = t - beat.time;
    if (elapsed < 0 || elapsed > 0.48) return 0;
    const attack = smooth(elapsed / 0.035) * smooth((0.48-elapsed)/0.08);
    return attack * Math.exp(-elapsed / 0.14) * beat.strength * effect.amount;
  }

  function drawBeatAccents(t) {
    if(data.motionTheme==='ballad'){drawBalladAtmosphere(t);return;}
    const pulse = beatPulse(t);
    if (pulse < 0.002) return;
    const { r, g, b } = hexToRgb(data.accentColor);
    ctx.save();
    const glow = ctx.createRadialGradient(W / 2, H / 2, W * 0.24, W / 2, H / 2, W * 0.65);
    glow.addColorStop(0, `rgba(${r},${g},${b},0)`);
    glow.addColorStop(1, `rgba(${r},${g},${b},${0.16 * pulse})`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.2 * pulse;
    ctx.strokeStyle = data.accentColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(W * (0.5 - 0.18 * pulse), H * 0.89);
    ctx.lineTo(W * (0.5 + 0.18 * pulse), H * 0.89);
    ctx.stroke();
    ctx.restore();
  }

  function instrumentalVisibility(t) {
    let visibility = 1;
    for (const seg of sortedLyrics()) {
      const begin = Math.max(0, seg.start - 2);
      const end = seg.end + 0.4;
      if (t >= begin && t <= end) return 0;
      const distance = t < begin ? begin - t : t - end;
      visibility = Math.min(visibility, clamp(distance / 0.8, 0, 1));
    }
    return visibility;
  }

  function spectrumAt(t, band) {
    const spectrum=data.beatEffect?.spectrum;
    if (!spectrum?.frames.length) return beatPulse(t);
    const position=clamp(t*spectrum.fps,0,spectrum.frames.length-1);
    const at=Math.floor(position), blend=smooth(position-at);
    const a=spectrum.frames[at], b=spectrum.frames[Math.min(at+1,spectrum.frames.length-1)];
    const index=Math.min(band,spectrum.bands-1);
    return (a[index]+(b[index]-a[index])*blend)/255;
  }

  const musicGlyphs = new Map();
  function musicGlyph(symbol) {
    if (musicGlyphs.has(symbol)) return musicGlyphs.get(symbol);
    const layer=document.createElement('canvas');layer.width=160;layer.height=160;
    const g=layer.getContext('2d');g.font='100px "Segoe UI Emoji",sans-serif';
    g.textAlign='center';g.textBaseline='middle';g.fillText(symbol,80,83);
    musicGlyphs.set(symbol,layer);return layer;
  }

  let introArtwork=null, introArtworkKey='';
  let storybookArtwork=null, storybookKey='';
  // 2026-11-15: Khách hàng phản hồi tên bài hát chưa rõ với nền; trước đó drawStorybookIntro dùng tông mực tối (ink đậm) không có bóng đổ hay hào quang khiến chữ bị chìm vào nền đêm tối, nên nâng cấp đổ bóng kép (deep contrast shadow + accent glow aura) và dùng màu chữ sáng nổi bật rõ nét trên mọi nền.
  function drawStorybookIntro(t) {
    const intro=data.intro;
    const end=Math.min(Number(intro.end)||30,(sortedLyrics()[0]?.start||31.2)-1.2);
    if(t<0 || t>=end)return;
    const head=intro.headline||'Yêu Em', tail=intro.subline||'Đến giây phút cuối cùng';
    const key=JSON.stringify([head,tail,intro.subtitle,intro.ink,intro.secondaryInk,intro.creditInk,data.accentColor]);
    if(!storybookArtwork || key!==storybookKey){
      storybookKey=key;
      const raster=(text,font,height,color,spacing=0)=>{
        const c=document.createElement('canvas');c.width=W;c.height=height;
        const g=c.getContext('2d');g.font=font;g.textBaseline='middle';
        const letters=[...text];const width=letters.reduce((n,ch)=>n+g.measureText(ch).width,0)+Math.max(0,letters.length-1)*spacing;

        // Deep contrast background shadow
        g.fillStyle='#000000';
        g.shadowColor='rgba(0,0,0,0.92)';
        g.shadowBlur=18;
        g.shadowOffsetY=4;
        let x=(W-width)/2;
        for(const ch of letters){g.fillText(ch,x,height/2);x+=g.measureText(ch).width+spacing;}

        // Pure white luminous halo with deep contrast shadow
        g.shadowColor='rgba(255, 255, 255, 0.95)';
        g.shadowBlur=22;
        g.shadowOffsetY=0;
        g.fillStyle='#ffffff';
        x=(W-width)/2;
        for(const ch of letters){g.fillText(ch,x,height/2);x+=g.measureText(ch).width+spacing;}

        // Crisp pure white core
        g.shadowBlur=4;
        g.fillStyle='#ffffff';
        x=(W-width)/2;
        for(const ch of letters){g.fillText(ch,x,height/2);x+=g.measureText(ch).width+spacing;}

        return {canvas:c,width};
      };
      storybookArtwork={
        head:raster(head,'italic 600 140px "Playfair Display",Georgia,serif',230,'#ffffff'),
        tail:raster(tail.toLocaleUpperCase('vi-VN'),'600 32px "Be Vietnam Pro",sans-serif',100,'#ffffff',3.2),
        credit:raster(intro.subtitle||'','500 22px "Be Vietnam Pro",sans-serif',70,'#ffffff')
      };
    }
    const out=smooth((end-t)/1.4), enter=smooth((t-.25)/1.7), reveal=smooth((t-1.5)/1.7);
    const art=storybookArtwork;
    ctx.save();
    ctx.globalAlpha=enter*out;
    ctx.drawImage(art.head.canvas,-26*(1-enter),H*.22-115+22*(1-enter));
    ctx.globalAlpha=reveal*out;
    ctx.save();ctx.beginPath();ctx.rect((W-art.tail.width)/2-6,H*.345-50,(art.tail.width+12)*reveal,100);ctx.clip();
    ctx.drawImage(art.tail.canvas,0,H*.345-50);ctx.restore();
    const line=smooth((t-2.5)/1.5);
    ctx.globalAlpha=line*out*.8;
    ctx.strokeStyle='#ffffff';
    ctx.shadowColor='rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur=8;
    ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(W*.5-90*line,H*.392);ctx.lineTo(W*.5+90*line,H*.392);ctx.stroke();
    ctx.shadowBlur=0;
    ctx.globalAlpha=smooth((t-2.8)/1.5)*out*.88;
    ctx.drawImage(art.credit.canvas,0,H*.435-35);
    ctx.restore();
  }

  let balladTitleArtwork=null, balladTitleKey='';
  function drawBalladIntro(t) {
    const intro=data.intro;
    const end=Math.min(Number(intro.titleEnd)||15.5,Number(intro.end)||30);
    if(t<0 || t>=end)return;
    const lines=intro.lines||['Yêu em đến','giây phút cuối cùng'];
    const key=JSON.stringify([lines,intro.subtitle]);
    if(!balladTitleArtwork || key!==balladTitleKey){
      balladTitleKey=key;
      balladTitleArtwork=lines.map((text,index)=>{
        const c=document.createElement('canvas');c.width=1200;c.height=170;
        const g=c.getContext('2d');
        g.font='italic 500 84px "Lora",Georgia,serif';g.textBaseline='middle';
        g.fillStyle=index?'#dae7f2':'#f1f5f8';
        g.fillText(text,10,85,1150);return c;
      });
      const credit=document.createElement('canvas');credit.width=1200;credit.height=70;
      const g=credit.getContext('2d');g.font='400 22px "Be Vietnam Pro",sans-serif';
      g.fillStyle='#9cb7cb';g.textBaseline='middle';g.fillText(intro.subtitle||'',10,35);
      balladTitleArtwork.push(credit);
    }
    const fade=smooth((end-t)/2.2);
    ctx.save();
    for(let i=0;i<2;i++){
      const appear=smooth((t-(1+i*1.3))/1.9);
      ctx.globalAlpha=appear*fade;
      ctx.drawImage(balladTitleArtwork[i],W*.125+14*(1-appear),H*(.43+i*.115)-85);
    }
    ctx.globalAlpha=smooth((t-4.5)/1.5)*fade*.8;
    ctx.drawImage(balladTitleArtwork[2],W*.125,H*.68-35);
    ctx.restore();
  }

  function drawBalladAtmosphere(t) {
    const gap=instrumentalVisibility(t);
    const energy=data.beatEffect?.enabled ? spectrumAt(t,3)*(data.beatEffect.amount||0) : 0;
    ctx.save();
    const light=ctx.createRadialGradient(W*.55,H*.43,20,W*.55,H*.43,W*.55);
    light.addColorStop(0,`rgba(134,188,219,${.014+energy*.035})`);
    light.addColorStop(1,'rgba(134,188,219,0)');
    ctx.fillStyle=light;ctx.fillRect(0,0,W,H);
    for(let i=0;i<14;i++){
      const p=particles[i];
      const travel=mod(t*.018+p.phase/(Math.PI*2),1);
      const alpha=Math.sin(travel*Math.PI)**2*(.08+.16*gap);
      const x=W*(.12+p.x*.76)+Math.sin(t*.16+p.phase)*14;
      const y=H*(.76-travel*.30);
      ctx.globalAlpha=alpha;ctx.fillStyle='#c4e4ee';
      ctx.beginPath();ctx.arc(x,y,.9+p.z*1.2,0,Math.PI*2);ctx.fill();
    }
    ctx.restore();
  }

  // 2026-11-16: Khách hàng yêu cầu hiệu ứng nhạc dạo và chạy chữ mới có beat theo nhịp cho bài Remix trên nền Hồ Hoàng Hôn Dưới Ánh Trăng Sao (giữ font Oswald); bổ sung drawRemixIntro với vòng sóng phổ nhạc tròn + hào quang neon theo nhịp trống Cha Cha Cha và nâng cấp drawInstrumental + drawWords đập theo beat.
  function drawRemixIntro(t) {
    const intro = data.intro;
    const first = sortedLyrics()[0]?.start ?? 15.1;
    const end = Math.max(0, Math.min(Number(intro.end) || first - 0.35, first - 0.35));
    if (end <= 0 || t < 0 || t >= end) return;
    const title = String(intro.title || data.songTitle || '').trim();
    const subtitle = String(intro.subtitle || data.artist || '').trim();
    const upperTitle = title.toLocaleUpperCase('vi-VN');
    const subUpper = subtitle.toLocaleUpperCase('vi-VN');
    const fontReady = isCanvasFontReady('700 84px "Oswald"', upperTitle + ' ' + subUpper);
    const key = JSON.stringify(['remix', title, subtitle, data.accentColor, fontReady]);
    if (!introArtwork || key !== introArtworkKey) {
      introArtworkKey = key;
      if (!fontReady && document.fonts?.load) {
        document.fonts.load('700 84px "Oswald"', upperTitle + ' ' + subUpper).then(() => { clearAllTextArtworks(); draw(time()); }).catch(() => {});
      }
      introArtwork = document.createElement('canvas');
      introArtwork.width = W;
      introArtwork.height = 320;
      const g = introArtwork.getContext('2d');
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '700 84px "Oswald","Be Vietnam Pro","Segoe UI",Arial,sans-serif';
      const fitted = Math.min(84, 84 * (W * 0.86) / Math.max(1, g.measureText(upperTitle).width));
      g.font = `700 ${fitted}px "Oswald","Be Vietnam Pro","Segoe UI",Arial,sans-serif`;

      // Deep contrast shadow
      g.shadowColor = 'rgba(0, 0, 0, 0.95)';
      g.shadowBlur = 18;
      g.shadowOffsetY = 4;
      g.fillStyle = '#000000';
      g.fillText(upperTitle, W / 2, 118);

      // Outer neon cyan-sunset halo
      g.shadowColor = data.accentColor || '#38bdf8';
      g.shadowBlur = 28;
      g.shadowOffsetY = 0;
      g.fillStyle = '#ffffff';
      g.fillText(upperTitle, W / 2, 118);

      // Crisp white core
      g.shadowColor = '#fbbf24';
      g.shadowBlur = 10;
      g.fillStyle = '#ffffff';
      g.fillText(upperTitle, W / 2, 118);

      // Subtitle badge
      g.font = '600 26px "Oswald","Be Vietnam Pro","Segoe UI",Arial,sans-serif';
      const subW = g.measureText(subUpper).width + 64;
      g.shadowColor = 'rgba(0, 0, 0, 0.85)';
      g.shadowBlur = 12;
      g.fillStyle = 'rgba(8, 15, 35, 0.72)';
      g.strokeStyle = data.accentColor || '#38bdf8';
      g.lineWidth = 1.8;
      g.beginPath();
      g.roundRect((W - subW) / 2, 186, subW, 48, 24);
      g.fill();
      g.stroke();

      g.shadowColor = data.accentColor || '#38bdf8';
      g.shadowBlur = 10;
      g.fillStyle = '#fef08a';
      g.fillText(subUpper, W / 2, 211);
    }

    const enter = smooth(t / 0.9);
    const out = smooth((end - t) / 0.9);
    const alpha = enter * out;
    const pulse = beatPulse(t);
    const cx = W * 0.5, cy = H * 0.23;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Expanding beat shockwave rings around the emblem
    for (let r = 0; r < 2; r++) {
      const phase = ((t * 1.1 + r * 0.5) % 1);
      ctx.save();
      ctx.globalAlpha = alpha * (1 - phase) * (0.35 + 0.45 * pulse);
      ctx.strokeStyle = r === 0 ? (data.accentColor || '#38bdf8') : '#fbbf24';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(cx, cy, 58 + phase * 95 + pulse * 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Radial 36-bar circular equalizer synced to spectrum & beat
    const radialBars = 36;
    const baseRadius = 56 + pulse * 10;
    for (let i = 0; i < radialBars; i++) {
      const angle = (i / radialBars) * Math.PI * 2 - Math.PI / 2 + t * 0.25;
      const band = Math.floor(Math.abs((i % 18) - 9) * 1.8);
      const lvl = spectrumAt(t, band);
      const barLen = 8 + lvl * 42 + pulse * 18;
      const x1 = cx + Math.cos(angle) * baseRadius;
      const y1 = cy + Math.sin(angle) * baseRadius;
      const x2 = cx + Math.cos(angle) * (baseRadius + barLen);
      const y2 = cy + Math.sin(angle) * (baseRadius + barLen);
      ctx.strokeStyle = i % 2 === 0 ? '#38bdf8' : '#fbbf24';
      ctx.lineWidth = 3.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Center pulsing emblem
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(0.76 + pulse * 0.14, 0.76 + pulse * 0.14);
    ctx.drawImage(musicGlyph('🎧'), -80, -80);
    ctx.restore();

    // Title & subtitle with beat breath and slide-in
    ctx.save();
    const titleY = H * 0.46;
    const titleScale = (0.94 + 0.06 * enter) * (1 + pulse * 0.028);
    ctx.translate(W / 2, titleY);
    ctx.scale(titleScale, titleScale);
    ctx.drawImage(introArtwork, -W / 2, -140);

    // Beat-reactive laser wings beside the title
    const wingSpan = (180 + pulse * 140) * enter;
    const wingGradL = ctx.createLinearGradient(-wingSpan - 120, 0, -60, 0);
    wingGradL.addColorStop(0, 'rgba(56, 189, 248, 0)');
    wingGradL.addColorStop(1, '#fbbf24');
    ctx.strokeStyle = wingGradL;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-wingSpan - 120, 18);
    ctx.lineTo(-60, 18);
    ctx.stroke();

    const wingGradR = ctx.createLinearGradient(60, 0, wingSpan + 120, 0);
    wingGradR.addColorStop(0, '#fbbf24');
    wingGradR.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.strokeStyle = wingGradR;
    ctx.beginPath();
    ctx.moveTo(60, 18);
    ctx.lineTo(wingSpan + 120, 18);
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }

  let sunsetRemixArtwork = null, sunsetRemixKey = '';
  let homecomingArtwork = null, homecomingKey = '';
  function clearAllTextArtworks() {
    lyricArtwork.clear();
    introArtwork = null;
    introArtworkKey = '';
    sunsetRemixArtwork = null;
    sunsetRemixKey = '';
    homecomingArtwork = null;
    homecomingKey = '';
    storybookArtwork = null;
    storybookKey = '';
    balladTitleArtwork = null;
    balladTitleKey = '';
  }

  // 2026-11-16: Khách hàng yêu cầu thêm bài thứ 2 (Đến Khi Nào - ChaChaCha Remix) nối sau bài 1 trên cùng hình nền Hồ Hoàng Hôn Dưới Ánh Trăng Sao nhưng có hiệu ứng nhạc dạo và chạy chữ khác một chút, đồng thời sửa lỗi font chữ "ĐẾN KHI NÀO" bị rơi vào Arial Black/Times New Roman; dùng đúng weight 700 cho Oswald kèm fallback Be Vietnam Pro và kiểm tra isCanvasFontReady trước khi khóa sunsetRemixKey.
  function drawSunsetRemixIntro(t, customCfg = null) {
    const cfg = customCfg || data.intro;
    if (!cfg?.enabled) return;
    const start = Number(cfg.start) || 0;
    const first = sortedLyrics()[0]?.start ?? 32.1;
    const end = Number(cfg.end) || (start + Math.max(5, first - 0.4));
    if (t < start || t >= end) return;
    const localT = t - start;
    const dur = end - start;
    const title = String(cfg.title || data.songTitle || '').trim();
    const subtitle = String(cfg.subtitle || data.artist || '').trim();
    const upperTitle = title.toLocaleUpperCase('vi-VN');
    const subUpper = subtitle.toLocaleUpperCase('vi-VN');
    const fontReady = isCanvasFontReady('700 86px "Oswald"', upperTitle + ' ' + subUpper);
    const key = JSON.stringify(['sunset-remix', title, subtitle, fontReady]);
    if (!sunsetRemixArtwork || key !== sunsetRemixKey) {
      sunsetRemixKey = key;
      if (!fontReady && document.fonts?.load) {
        document.fonts.load('700 86px "Oswald"', upperTitle + ' ' + subUpper).then(() => { clearAllTextArtworks(); draw(time()); }).catch(() => {});
      }
      sunsetRemixArtwork = document.createElement('canvas');
      sunsetRemixArtwork.width = W;
      sunsetRemixArtwork.height = 360;
      const g = sunsetRemixArtwork.getContext('2d');
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '700 86px "Oswald","Be Vietnam Pro","Segoe UI",Arial,sans-serif';
      const fitted = Math.min(86, 86 * (W * 0.86) / Math.max(1, g.measureText(upperTitle).width));
      g.font = `700 ${fitted}px "Oswald","Be Vietnam Pro","Segoe UI",Arial,sans-serif`;

      g.shadowColor = 'rgba(0, 0, 0, 0.95)';
      g.shadowBlur = 18;
      g.shadowOffsetY = 4;
      g.fillStyle = '#000000';
      g.fillText(upperTitle, W / 2, 134);

      g.shadowColor = '#fb923c';
      g.shadowBlur = 30;
      g.shadowOffsetY = 0;
      g.fillStyle = '#ffffff';
      g.fillText(upperTitle, W / 2, 134);

      g.shadowColor = '#f472b6';
      g.shadowBlur = 12;
      g.fillStyle = '#fffbeb';
      g.fillText(upperTitle, W / 2, 134);

      g.font = '600 26px "Oswald","Be Vietnam Pro","Segoe UI",Arial,sans-serif';
      const subW = g.measureText(subUpper).width + 72;
      g.shadowColor = 'rgba(0, 0, 0, 0.88)';
      g.shadowBlur = 12;
      g.fillStyle = 'rgba(28, 12, 24, 0.76)';
      g.strokeStyle = '#fb923c';
      g.lineWidth = 2;
      g.beginPath();
      g.roundRect((W - subW) / 2, 206, subW, 50, 12);
      g.fill();
      g.stroke();

      g.shadowColor = '#fb923c';
      g.shadowBlur = 10;
      g.fillStyle = '#fed7aa';
      g.fillText(subUpper, W / 2, 232);
    }

    const enter = smooth(localT / 0.95);
    const out = smooth((dur - localT) / 0.95);
    const alpha = enter * out;
    const pulse = beatPulse(t);
    const cx = W * 0.5, cy = H * 0.23;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Expanding sunset shockwave rings from 0.0s onward
    for (let r = 0; r < 3; r++) {
      const phase = (t * 0.95 + r / 3) % 1;
      ctx.save();
      ctx.globalAlpha = alpha * (1 - phase) * (0.38 + 0.42 * pulse);
      ctx.strokeStyle = r % 2 === 0 ? '#fb923c' : '#fde047';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(cx, cy, 56 + phase * 115 + pulse * 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Rotating diamond beat frame around sunset emblem
    for (let d = 0; d < 2; d++) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t * (d === 0 ? 0.85 : -0.65) + d * (Math.PI / 4));
      const sz = 66 + d * 22 + pulse * 20 + Math.sin(t * 4.5 + d) * 6;
      ctx.strokeStyle = d === 0 ? '#fb923c' : '#f472b6';
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 14;
      ctx.lineWidth = 2.4;
      ctx.strokeRect(-sz / 2, -sz / 2, sz, sz);
      ctx.restore();
    }

    // Sunburst upper-arc equalizer (reads melody + bass bands + continuous harmonic wave so 0s-16s never freezes)
    const arcBars = 32;
    const arcRadius = 74 + pulse * 10;
    for (let i = 0; i <= arcBars; i++) {
      const u = i / arcBars;
      const angle = Math.PI + u * Math.PI;
      const midBand = 6 + (i % 12);
      const bassBand = Math.min(5, Math.floor(Math.abs(u - 0.5) * 12));
      const specVal = Math.max(spectrumAt(t, midBand), spectrumAt(t, bassBand));
      const harmonic = 0.28 + 0.24 * Math.sin(t * 6.8 + i * 0.48) + 0.16 * Math.cos(t * 4.3 - i * 0.35);
      const lvl = Math.max(specVal, harmonic);
      const barLen = 12 + lvl * 52 + pulse * 22;
      const x1 = cx + Math.cos(angle) * arcRadius;
      const y1 = cy + Math.sin(angle) * arcRadius;
      const x2 = cx + Math.cos(angle) * (arcRadius + barLen);
      const y2 = cy + Math.sin(angle) * (arcRadius + barLen);
      ctx.strokeStyle = i % 2 === 0 ? '#fb923c' : '#fde047';
      ctx.lineWidth = 3.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(cx, cy + Math.sin(t * 3.6) * 4);
    const emblemScale = 0.78 + pulse * 0.16 + 0.04 * Math.sin(t * 5.2);
    ctx.scale(emblemScale, emblemScale);
    ctx.drawImage(musicGlyph('🌅'), -80, -80);
    ctx.restore();

    ctx.save();
    const titleY = H * 0.46;
    const bounceOffset = Math.sin(localT * 3.6) * 4.5 - pulse * 7;
    const titleScale = (0.92 + 0.08 * enter) * (1 + pulse * 0.035 + 0.012 * Math.sin(t * 4.8));
    ctx.translate(W / 2, titleY + bounceOffset);
    ctx.scale(titleScale, titleScale);
    ctx.drawImage(sunsetRemixArtwork, -W / 2, -145);

    // Animated sunset laser wings flanking the title badge
    const wingSpan = (190 + pulse * 150 + 35 * Math.sin(t * 5.0)) * enter;
    const wingGradL = ctx.createLinearGradient(-wingSpan - 130, 0, -65, 0);
    wingGradL.addColorStop(0, 'rgba(251, 146, 60, 0)');
    wingGradL.addColorStop(1, '#fde047');
    ctx.strokeStyle = wingGradL;
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(-wingSpan - 130, 22);
    ctx.lineTo(-65, 22);
    ctx.stroke();

    const wingGradR = ctx.createLinearGradient(65, 0, wingSpan + 130, 0);
    wingGradR.addColorStop(0, '#fde047');
    wingGradR.addColorStop(1, 'rgba(251, 146, 60, 0)');
    ctx.strokeStyle = wingGradR;
    ctx.beginPath();
    ctx.moveTo(65, 22);
    ctx.lineTo(wingSpan + 130, 22);
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }

  // 2026-11-16: Khách hàng yêu cầu làm nguyên bài "Đi Về Nhà (Nhạc Sống Thôn Quê Cha Cha Cha)" với ảnh nền "Lối Về Nhà Trong Hoàng Hôn.png" và animation sáng tạo dạo nhạc hoàn toàn khác các video trước; bổ sung drawHomecomingIntro (đĩa than vàng xoay + đôi cánh sóng nhạc ngang đối xứng trên bầu trời hoàng hôn) và drawHomecomingInstrumental (khói nhạc ống khói + ánh đèn cửa sổ ấm áp + con đường sóng nhạc 3D uốn lượn về nhà).
  function drawHomecomingIntro(t, customCfg = null) {
    const cfg = customCfg || data.intro;
    if (!cfg?.enabled) return;
    const isOutro = t >= 246.5 && t <= 278.8;
    const start = isOutro ? 246.5 : (Number(cfg.start) || 0);
    const end = isOutro ? 278.8 : (Number(cfg.end) || 18.8);
    if (t < start || t >= end) return;
    const localT = t - start;
    const dur = Math.max(1, end - start);
    const title = String(cfg.title || data.songTitle || 'Đi Về Nhà').trim();
    const subtitle = String(cfg.subtitle || data.artist || '').trim();
    const upperTitle = title.toLocaleUpperCase('vi-VN');
    const subUpper = subtitle.toLocaleUpperCase('vi-VN');
    const fontReady = isCanvasFontReady('700 84px "Oswald"', upperTitle + ' ' + subUpper);
    const key = JSON.stringify(['homecoming-remix', title, subtitle, fontReady]);
    if (!homecomingArtwork || key !== homecomingKey) {
      homecomingKey = key;
      if (!fontReady && document.fonts?.load) {
        document.fonts.load('700 84px "Oswald"', upperTitle + ' ' + subUpper).then(() => { clearAllTextArtworks(); draw(time()); }).catch(() => {});
      }
      homecomingArtwork = document.createElement('canvas');
      homecomingArtwork.width = W;
      homecomingArtwork.height = 290;
      const g = homecomingArtwork.getContext('2d');
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '700 80px "Oswald","Be Vietnam Pro","Segoe UI",Arial,sans-serif';
      const fitted = Math.min(80, 80 * (W * 0.84) / Math.max(1, g.measureText(upperTitle).width));
      g.font = `700 ${fitted}px "Oswald","Be Vietnam Pro","Segoe UI",Arial,sans-serif`;

      g.shadowColor = 'rgba(15, 10, 5, 0.95)';
      g.shadowBlur = 18;
      g.shadowOffsetY = 4;
      g.fillStyle = '#000000';
      g.fillText(upperTitle, W / 2, 108);

      g.shadowColor = '#f59e0b';
      g.shadowBlur = 28;
      g.shadowOffsetY = 0;
      g.fillStyle = '#ffffff';
      g.fillText(upperTitle, W / 2, 108);

      g.shadowColor = '#fde047';
      g.shadowBlur = 10;
      g.fillStyle = '#fffbeb';
      g.fillText(upperTitle, W / 2, 108);

      g.font = '600 24px "Oswald","Be Vietnam Pro","Segoe UI",Arial,sans-serif';
      const subW = g.measureText(subUpper).width + 68;
      g.shadowColor = 'rgba(0, 0, 0, 0.88)';
      g.shadowBlur = 12;
      g.fillStyle = 'rgba(36, 18, 10, 0.78)';
      g.strokeStyle = '#fbbf24';
      g.lineWidth = 2;
      g.beginPath();
      g.roundRect((W - subW) / 2, 168, subW, 46, 23);
      g.fill();
      g.stroke();

      g.shadowColor = '#f59e0b';
      g.shadowBlur = 8;
      g.fillStyle = '#fef08a';
      g.fillText(subUpper, W / 2, 192);
    }

    const enter = smooth(localT / 1.0);
    const out = smooth((dur - localT) / 1.1);
    const alpha = enter * out;
    const pulse = beatPulse(t);
    const cx = W * 0.5, cy = H * 0.135;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Symmetrical Horizontal Equalizer Wings flanking the spinning Vinyl Turntable
    const wingBars = 22;
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < wingBars; i++) {
        const u = i / (wingBars - 1);
        const band = 4 + (i % 14);
        const spec = Math.max(spectrumAt(t, band), spectrumAt(t, i % 6) * 0.8);
        const wave = 0.26 + 0.22 * Math.sin(t * 6.4 - i * 0.42);
        const lvl = Math.max(spec, wave);
        const barH = (10 + lvl * 46 + pulse * 20) * (1 - u * 0.55);
        const bx = cx + side * (78 + i * 15);
        const by = cy + Math.sin(t * 3.8 + i * 0.35) * 4;
        ctx.strokeStyle = i % 3 === 0 ? '#fef08a' : i % 3 === 1 ? '#f59e0b' : '#fb7185';
        ctx.lineWidth = 4.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(bx, by - barH / 2);
        ctx.lineTo(bx, by + barH / 2);
        ctx.stroke();
      }
    }

    // Spinning Golden Vinyl Record (Đĩa than Nhạc Sống Thôn Quê)
    const vinylR = 54 + pulse * 8;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 1.65);
    const vGrad = ctx.createRadialGradient(0, 0, 10, 0, 0, vinylR);
    vGrad.addColorStop(0, '#f59e0b');
    vGrad.addColorStop(0.38, '#291d12');
    vGrad.addColorStop(0.85, '#1c140d');
    vGrad.addColorStop(1, '#fbbf24');
    ctx.fillStyle = vGrad;
    ctx.shadowColor = '#f59e0b';
    ctx.shadowBlur = 18 + pulse * 14;
    ctx.beginPath();
    ctx.arc(0, 0, vinylR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Vinyl grooves + golden reflection arcs
    for (let gr = 26; gr < vinylR - 5; gr += 7) {
      ctx.strokeStyle = 'rgba(254, 240, 138, 0.38)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, 0, gr, 0.2, 1.35);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, gr, Math.PI + 0.2, Math.PI + 1.35);
      ctx.stroke();
    }
    ctx.restore();

    // Center Home Icon inside the vinyl
    ctx.save();
    ctx.translate(cx, cy);
    const homeSc = 0.56 + pulse * 0.12;
    ctx.scale(homeSc, homeSc);
    ctx.drawImage(musicGlyph('🏡'), -80, -80);
    ctx.restore();

    // Title & Subtitle Banner in upper sky
    ctx.save();
    const titleY = H * 0.295;
    const bounceOffset = Math.sin(localT * 3.4) * 3.5 - pulse * 5;
    const titleScale = (0.94 + 0.06 * enter) * (1 + pulse * 0.028);
    ctx.translate(W / 2, titleY + bounceOffset);
    ctx.scale(titleScale, titleScale);
    ctx.drawImage(homecomingArtwork, -W / 2, -120);
    ctx.restore();

    ctx.restore();
  }

  function drawHomecomingInstrumental(t) {
    const effect = data.beatEffect;
    if (!effect?.enabled) return;
    const visibility = smooth(instrumentalVisibility(t));
    const pulse = beatPulse(t);

    ctx.save();

    // 1. Rotating Golden Sunbeams & Beat Halo around the painted setting sun (x=0.692*W, y=0.378*H)
    const sunX = W * 0.692, sunY = H * 0.378;
    const sunRays = 12;
    for (let r = 0; r < sunRays; r++) {
      const ang = (r / sunRays) * Math.PI * 2 + t * 0.18;
      const spec = Math.max(spectrumAt(t, r % 12), 0.25);
      const rayLen = 45 + spec * 65 + pulse * 35;
      ctx.save();
      ctx.globalAlpha = (0.16 + 0.18 * pulse) * (0.6 + 0.4 * visibility);
      ctx.strokeStyle = r % 2 === 0 ? '#fef08a' : '#fb923c';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sunX + Math.cos(ang) * 24, sunY + Math.sin(ang) * 24);
      ctx.lineTo(sunX + Math.cos(ang) * (24 + rayLen), sunY + Math.sin(ang) * (24 + rayLen));
      ctx.stroke();
      ctx.restore();
    }

    // 2. Warm Hearth Glow at the Cottage Windows (x=0.768*W, y=0.515*H) + Musical Chimney Notes
    const houseX = W * 0.768, houseY = H * 0.515;
    const hearthR = 38 + pulse * 26 + 8 * Math.sin(t * 4.2);
    const hearthGrad = ctx.createRadialGradient(houseX, houseY, 2, houseX, houseY, hearthR);
    hearthGrad.addColorStop(0, `rgba(254, 240, 138, ${0.42 + 0.32 * pulse})`);
    hearthGrad.addColorStop(0.5, `rgba(245, 158, 11, ${0.22 + 0.18 * pulse})`);
    hearthGrad.addColorStop(1, 'rgba(245, 158, 11, 0)');
    ctx.fillStyle = hearthGrad;
    ctx.beginPath();
    ctx.arc(houseX, houseY, hearthR, 0, Math.PI * 2);
    ctx.fill();

    // Musical notes rising from the cottage chimney (x=0.793*W, y=0.455*H)
    const chimX = W * 0.793, chimY = H * 0.455;
    const chimGlyphs = ['♪', '♫', '✨', '🌸'];
    for (let c = 0; c < 4; c++) {
      const prog = (t * 0.28 + c * 0.25) % 1;
      const nx = chimX + Math.sin(prog * Math.PI * 2.5 + c) * (18 + prog * 28) + prog * 22;
      const ny = chimY - prog * 135;
      const nAlpha = Math.sin(prog * Math.PI) * (0.55 + 0.35 * pulse);
      ctx.save();
      ctx.globalAlpha = nAlpha;
      ctx.translate(nx, ny);
      const nSc = 0.22 + prog * 0.18 + pulse * 0.06;
      ctx.scale(nSc, nSc);
      ctx.drawImage(musicGlyph(chimGlyphs[c]), -80, -80);
      ctx.restore();
    }

    // 3. Winding Homecoming Road Firefly & Beat-Step Stream from (0.24*W, 0.92*H) to (0.73*W, 0.57*H)
    const roadSteps = 28;
    for (let s = 0; s < roadSteps; s++) {
      const u = ((s / roadSteps) + t * 0.08) % 1;
      // Cubic Bezier following the dirt road in "Lối Về Nhà Trong Hoàng Hôn.png"
      const inv = 1 - u;
      const rx = inv * inv * inv * (W * 0.25) + 3 * inv * inv * u * (W * 0.36) + 3 * inv * u * u * (W * 0.64) + u * u * u * (W * 0.73);
      const ry = inv * inv * inv * (H * 0.94) + 3 * inv * inv * u * (H * 0.68) + 3 * inv * u * u * (H * 0.62) + u * u * u * (H * 0.56);
      const spec = Math.max(spectrumAt(t, s % 16), 0.22);
      const hop = Math.abs(Math.sin(t * 5.2 + s * 0.55)) * (8 + spec * 24 + pulse * 18) * (1 - u * 0.55);
      const dotR = (2.2 + spec * 3.8 + pulse * 2.4) * (1 - u * 0.5);
      ctx.globalAlpha = Math.sin(u * Math.PI) * (0.45 + 0.45 * visibility);
      ctx.fillStyle = s % 3 === 0 ? '#fef08a' : s % 3 === 1 ? '#f59e0b' : '#fb7185';
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(rx, ry - hop, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    // 4. Floating Background Vocal Ad-libs ("bay ngoài lời") drifting in the sky outside the main center lyrics
    // 2026-11-16: Khách hàng phản hồi các từ ngân "ooh yeahhh" là tiếng bè phiêu bay bên ngoài chứ không nên gộp vào dòng lời chính; tách toàn bộ "Ooh-ah", "Ooh yeahhh", "Yeah-eh" ra khỏi data.lyrics để lời chính chuẩn 100%, đồng thời vẽ hiệu ứng chữ bè bay lơ lửng nhẹ ở hai bên bầu trời ngoài vùng lời chính.
    const adlibs = [
      { start: 7.45, end: 8.65, text: '♪ Ooh-ah ~', side: -1 },
      { start: 13.85, end: 15.40, text: '♫ Ooh yeahhh ~', side: 1 },
      { start: 21.55, end: 22.80, text: '♪ Yeah-eh ~', side: -1 },
      { start: 85.10, end: 86.85, text: '♫ Ooh yeahhh ~', side: 1 },
      { start: 92.75, end: 93.85, text: '♪ Ooh-ah ~', side: -1 },
      { start: 99.15, end: 100.65, text: '♫ Ooh yeahhh ~', side: 1 },
      { start: 107.05, end: 108.25, text: '♪ Yeah-eh ~', side: -1 },
      { start: 111.20, end: 112.45, text: '♫ Ooh-ooh ~', side: 1 },
      { start: 178.40, end: 179.70, text: '♪ Ooh-ah ~', side: -1 },
      { start: 184.45, end: 186.00, text: '♫ Ooh yeahhh ~', side: 1 },
      { start: 191.95, end: 193.25, text: '♪ Yeah-eh ~', side: -1 },
      { start: 196.15, end: 197.25, text: '♫ Ooh-ooh ~', side: 1 },
      { start: 224.40, end: 225.65, text: '♪ Ooh-ah ~', side: -1 },
      { start: 230.65, end: 232.25, text: '♫ Ooh yeahhh ~', side: 1 },
      { start: 238.30, end: 239.60, text: '♪ Yeah-eh ~', side: -1 },
      { start: 242.10, end: 243.25, text: '♫ Ooh-ooh ~', side: 1 },
      { start: 246.30, end: 248.60, text: '🎶 Ooh yeahhh ~', side: -1 },
      { start: 268.00, end: 270.60, text: '✨ Yeahhh ~', side: 1 }
    ];
    for (const ad of adlibs) {
      if (t < ad.start || t > ad.end) continue;
      const p = clamp((t - ad.start) / Math.max(0.2, ad.end - ad.start), 0, 1);
      const env = Math.sin(p * Math.PI);
      const ax = W * (ad.side < 0 ? 0.22 : 0.78) + ad.side * p * 34 + Math.sin(p * Math.PI * 2) * 10;
      const ay = H * 0.34 - p * 54;
      ctx.save();
      ctx.globalAlpha = env * 0.86;
      ctx.translate(ax, ay);
      ctx.rotate(ad.side * (-0.08 + p * 0.05));
      const sc = 0.88 + 0.16 * env + pulse * 0.08;
      ctx.scale(sc, sc);
      ctx.font = 'italic 700 34px "Playfair Display","Be Vietnam Pro",serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#000000';
      ctx.fillText(ad.text, 0, 2);
      ctx.shadowColor = '#f59e0b';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#fef08a';
      ctx.fillText(ad.text, 0, 0);
      ctx.restore();
    }

    // 5. Full Instrumental Solo / Dạo Nhạc Showcase (3D Horizon Wave + Countryside Carousel)
    if (visibility > 0.02) {
      const waveX0 = W * 0.10, waveSpan = W * 0.80, waveBaseY = H * 0.84;
      const waveColors = ['#f59e0b', '#fef08a', '#fb7185'];
      for (let wl = 0; wl < 3; wl++) {
        ctx.save();
        ctx.strokeStyle = waveColors[wl];
        ctx.shadowColor = waveColors[wl];
        ctx.shadowBlur = 12;
        ctx.lineWidth = 3.6 - wl * 0.7;
        ctx.globalAlpha = visibility * (0.78 - wl * 0.16);
        ctx.beginPath();
        for (let k = 0; k <= 72; k++) {
          const u = k / 72;
          const taper = Math.sin(u * Math.PI);
          const spec = Math.max(spectrumAt(t, (k + wl * 6) % 20), 0.24);
          const wy = waveBaseY + Math.sin(u * Math.PI * 5 - t * 4.6 + wl * 1.1) * (16 + spec * 44 + pulse * 26) * taper;
          if (k === 0) ctx.moveTo(waveX0, wy);
          else ctx.lineTo(waveX0 + waveSpan * u, wy);
        }
        ctx.stroke();
        ctx.restore();
      }

      // Floating Musical & Homecoming Icons during Instrumental Solo
      const soloIcons = ['🌸', '🎸', '🏡', '🥁', '🌼'];
      for (let idx = 0; idx < soloIcons.length; idx++) {
        ctx.save();
        ctx.globalAlpha = visibility * 0.90;
        const ix = W * 0.5 + (idx - 2) * 145;
        const iy = H * 0.45 + Math.sin(t * 3.2 + idx * 0.9) * 10 - pulse * 14;
        ctx.translate(ix, iy);
        ctx.rotate(Math.sin(t * 2.5 + idx) * 0.08);
        const isc = 0.66 + pulse * 0.16;
        ctx.scale(isc, isc);
        ctx.drawImage(musicGlyph(soloIcons[idx]), -80, -80);
        ctx.restore();
      }
    }

    ctx.restore();
  }

  function drawIntro(t) {
    const intro=data.intro;
    if (intro?.enabled) {
      if(intro.style==='ballad') drawBalladIntro(t);
      else if(intro.style==='storybook') drawStorybookIntro(t);
      else if(intro.style==='sunset-remix') drawSunsetRemixIntro(t, intro);
      else if(intro.style==='homecoming-remix') drawHomecomingIntro(t, intro);
      else drawRemixIntro(t);
    }
    if (data.secondIntro?.enabled) {
      drawSunsetRemixIntro(t, data.secondIntro);
    }
  }

  function drawBalladInterlude(t) {
    const titleEnd=data.intro?.enabled ? (Number(data.intro.titleEnd)||15.5) : 0;
    const alpha=smooth(instrumentalVisibility(t))*smooth((t-titleEnd-.6)/1.1);
    if(alpha<.005)return;
    const energy=data.beatEffect?.enabled ? spectrumAt(t,3) : 0;
    const x0=W*.19, span=W*.62, cy=H*.58;
    ctx.save();
    const breath=NebulaMotion.beatBreath(data.beatEffect,t);
    const pulse = beatPulse(t);
    const glyphs=['✨','𝄞','💍','♫','✨'];
    for(let i=0;i<glyphs.length;i++){
      ctx.save();
      ctx.globalAlpha=alpha*.88;
      ctx.translate(W*.5+(i-2)*135,H*.33+Math.sin(t*.9+i*.8)*5);
      ctx.rotate(Math.sin(t*.6+i)*.025);
      const scale=.78+breath*.06+pulse*.04;
      ctx.scale(scale,scale);
      ctx.drawImage(musicGlyph(glyphs[i]),-60,-60);
      ctx.restore();
    }

    // 2026-11-15: Khách hàng phản hồi chữ "gian tấu" không phù hợp với không khí bài hát đám cưới; trước đó drawBalladInterlude hiển thị chữ "♪ GIAN TẤU · VÁY CƯỚI ♪" gây cứng nhắc, nên loại bỏ hoàn toàn khối text này, chỉ giữ dải sóng ánh sáng và nốt nhạc/ánh sao lơ lửng tinh tế.
    const colors=['#a5dfff','#ddc8fa','#e3f4ff'];
    for(let layer=0;layer<3;layer++){
      const gradient=ctx.createLinearGradient(x0,0,x0+span,0);
      gradient.addColorStop(0,'rgba(160,210,255,0)');
      gradient.addColorStop(.24,colors[layer]);
      gradient.addColorStop(.76,colors[layer]);
      gradient.addColorStop(1,'rgba(160,210,255,0)');
      ctx.globalAlpha=alpha*(.54-layer*.12);
      ctx.strokeStyle=gradient;ctx.lineWidth=3-layer*.55;
      ctx.shadowColor=colors[layer];ctx.shadowBlur=10;
      ctx.beginPath();
      for(let i=0;i<=90;i++){
        const u=i/90, taper=Math.sin(u*Math.PI);
        const wave=Math.sin(u*Math.PI*3+t*.85+layer*.9);
        const y=cy+(wave*(22+energy*22)+Math.sin(u*9-t*.43)*8+layer*7)*taper;
        if(i)ctx.lineTo(x0+span*u,y);else ctx.moveTo(x0,y);
      }
      ctx.stroke();
    }
    ctx.shadowBlur=0;
    for(let i=0;i<12;i++){
      const u=mod(t*.038+i*.083,1), pulse=Math.sin(u*Math.PI);
      ctx.globalAlpha=alpha*pulse*.65;ctx.fillStyle=i%2?'#e5d7fa':'#c7ecff';
      const x=x0+span*u, y=cy+Math.sin(u*Math.PI*3+t*.85)*27;
      ctx.beginPath();ctx.arc(x,y,1.4+1.5*particles[i].z,0,Math.PI*2);ctx.fill();
    }
    ctx.restore();
  }

  function drawInstrumental(t) {
    if(data.motionTheme==='ballad'){drawBalladInterlude(t);return;}
    if(data.intro?.style==='homecoming-remix'){drawHomecomingInstrumental(t);return;}
    const effect=data.beatEffect;
    if (!effect?.enabled) return;
    const visibility=smooth(instrumentalVisibility(t));
    const pulse=beatPulse(t);
    const {r,g,b}=hexToRgb(data.accentColor || '#38bdf8');
    const centerY=H*(data.intro?.style==='storybook' ? .91 : .89-.12*visibility);
    ctx.save();
    const bars=56, step=W*.62/bars;
    for(let i=0;i<bars;i++){
      const band=Math.abs(i-(bars-1)/2);
      const rawLevel=Math.max(spectrumAt(t,Math.floor(band)), spectrumAt(t, 6 + (i % 10)) * 0.75);
      const carrier=0.20 + 0.16 * Math.sin(t * 6.2 + i * 0.38) * Math.cos(t * 3.4 - i * 0.22);
      const level=Math.max(rawLevel, carrier);
      const amplitude=(.35+.65*visibility)*effect.amount;
      const height=6+level*(78+58*pulse)*amplitude;
      const x=W*.19+(i+.5)*step;
      ctx.globalAlpha=(.32+.56*visibility)*(.48+.52*level);
      ctx.fillStyle=i%3===0?'#fef08a':i%3===1?`rgb(${r},${g},${b})`:'#f472b6';
      ctx.beginPath();ctx.roundRect(x-3,centerY-height/2,5.5,height,3);ctx.fill();
    }
    if(visibility>.02 && data.intro?.style!=='storybook'){
      const beats=effect.beats;
      for(let i=beats.length-1;i>=0;i--){
        const age=t-beats[i].time;
        if(age<0)continue;if(age>1.1)break;if(i%2)continue;
        const p=age/1.1;ctx.globalAlpha=visibility*(1-p)*.28*effect.amount;
        ctx.strokeStyle=i%4===0?'#fbbf24':(data.accentColor || '#38bdf8');ctx.lineWidth=2.2;ctx.beginPath();
        ctx.ellipse(W/2,centerY,70+p*380,14+p*72,0,0,Math.PI*2);ctx.stroke();
      }
      const introEnd=Math.min(Number(data.intro?.end)||0,(sortedLyrics()[0]?.start||0)-0.4);
      const inIntro = data.intro?.enabled && t < introEnd;
      const x0=W*.16, span=W*.68, waveY=inIntro ? H*.68 : H*.50;
      const ribbonColors=['#fb923c','#38bdf8','#f472b6'];
      for(let layer=0;layer<3;layer++){
        ctx.save();
        ctx.strokeStyle=ribbonColors[layer];
        ctx.beginPath();
        for(let k=0;k<=64;k++){
          const u=k/64, taper=Math.sin(u*Math.PI);
          const spec=Math.max(spectrumAt(t, (k+layer*5)%18), 0.25);
          const y=waveY + (Math.sin(u*Math.PI*4 + t*3.8 + layer*1.1)*(22 + spec*36 + pulse*22))*taper;
          if(k===0) ctx.moveTo(x0,y); else ctx.lineTo(x0+span*u,y);
        }
        ctx.globalAlpha=visibility*(0.22-layer*0.04);
        ctx.lineWidth=8-layer*1.5;
        ctx.stroke();
        ctx.globalAlpha=visibility*(0.68-layer*0.14);
        ctx.lineWidth=3.0-layer*0.5;
        ctx.stroke();
        ctx.restore();
      }
      if(!inIntro){
        const notes=['🎵','🎧','✨','🎶'];
        for(let n=0;n<notes.length;n++){
          ctx.save();
          ctx.globalAlpha=visibility*0.85;
          const nx=W*0.5 + (n-1.5)*155;
          const ny=H*0.36 + Math.sin(t*2.4+n)*8 - pulse*10;
          ctx.translate(nx,ny);
          const sc=0.68 + pulse*0.14;
          ctx.scale(sc,sc);
          ctx.drawImage(musicGlyph(notes[n]),-80,-80);
          ctx.restore();
        }
      }
    }
    ctx.restore();
  }

  function projectTextOverlays() {
    const keys = ['id', 'type', 'name', 'text', 'font', 'textColor', 'glowColor',
      'x', 'y', 'scale', 'opacity', 'layer', 'alwaysOn', 'start', 'end',
      'effectIn', 'effectOut', 'effectDuration'];
    return stickers.filter(st => st.type === 'text').map(st =>
      Object.fromEntries(keys.filter(k => st[k] !== undefined).map(k => [k, st[k]])));
  }

  function importTextOverlays(entries) {
    if (!Array.isArray(entries)) return;
    stickers = stickers.filter(st => st.type !== 'text');
    for (const entry of entries.slice(0, 50)) {
      if (!entry || typeof entry.text !== 'string') continue;
      const start = Math.max(0, Number(entry.start) || 0);
      addTextOverlay({
        id: String(entry.id || Date.now() + Math.random()).replace(/[^a-zA-Z0-9_-]/g, '') || String(Date.now()), text: entry.text.slice(0, 2000),
        font: entry.font,
        textColor: /^#[0-9a-f]{6}$/i.test(entry.textColor) ? entry.textColor : '#ffffff',
        glowColor: /^#[0-9a-f]{6}$/i.test(entry.glowColor) ? entry.glowColor : data.accentColor,
        x: clamp(Number.isFinite(Number(entry.x)) ? Number(entry.x) : W / 2, 0, W),
        y: clamp(Number.isFinite(Number(entry.y)) ? Number(entry.y) : H / 2, 0, H),
        scale: clamp(Number(entry.scale) || 1, 0.2, 3.2),
        opacity: clamp(Number(entry.opacity) || 100, 10, 100),
        layer: entry.layer, alwaysOn: Boolean(entry.alwaysOn), start,
        end: Math.max(start + 0.1, Number(entry.end) || start + 5),
        effectIn: ['none', 'fade', 'slide', 'zoom'].includes(entry.effectIn) ? entry.effectIn : 'fade',
        effectOut: ['none', 'fade', 'slide', 'zoom'].includes(entry.effectOut) ? entry.effectOut : 'fade',
        effectDuration: clamp(Number(entry.effectDuration) || 0.45, 0.1, 3)
      }, {skipSave: true, deferRender: true});
    }
    buildStickerList();
    persistStickers();
  }

  // 2026-11-15: Khách hàng phản hồi hiệu ứng chữ bị tĩnh quá chán và không nhận các tùy chỉnh hiệu ứng/màu sắc/ánh sáng; trước đó drawWords bỏ qua item.offsetX, item.offsetY, item.scale, item.opacity khiến mọi kiểu hoạt ảnh đều đứng im, nên khôi phục đầy đủ phép biến đổi chuyển động từ NebulaMotion kết hợp lướt từ karaoke mượt mà và icon bồng bềnh theo nhịp.
  function drawWords(t) {
    const sorted = sortedLyrics();
    let selected = null;
    let selectedItem = null;

    // Pick single primary active segment
    for (const seg of sorted) {
      if (t >= seg.start && t < seg.end) {
        const item = renderLyricSegment(seg, null, null, t);
        if (item) {
          selected = seg;
          selectedItem = item;
          break;
        }
      }
      if (seg.start > t) break;
    }

    // Fallback: segment in exit tail
    if (!selected) {
      for (let i = sorted.length - 1; i >= 0; i--) {
        const seg = sorted[i];
        if (t >= seg.end && t < seg.end + 0.25) {
          const item = renderLyricSegment(seg, null, null, t);
          if (item) {
            selected = seg;
            selectedItem = item;
            break;
          }
        }
        if (seg.end < t - 0.3) break;
      }
    }

    if (!selected || !selectedItem) return;
    const item = selectedItem;
    const seg = selected;
    const art = item.art;
    // 2026-11-16: Khách hàng yêu cầu khi tựa bài hát còn hiển thị ở đầu bài thì chữ lời hát nằm thấp phía dưới để không đụng tựa bài, và ngay khi tựa bài vừa biến mất thì chữ tự động đẩy mượt lên giữa màn hình (H * 0.50); nội suy baseY theo trạng thái hiển thị của intro.
    let baseY = H * (data.position === 'upper' ? 0.33 : data.position === 'lower' ? 0.64 : 0.5);
    if (data.position !== 'upper' && data.intro?.enabled && data.intro?.style === 'homecoming-remix') {
      const introStart = Number(data.intro.start) || 0;
      const introEnd = Number(data.intro.end) || 18.8;
      const introActive = smooth((t - introStart) / 0.6) * (1 - smooth((t - (introEnd - 1.1)) / 1.1));
      const outroActive = smooth((t - 246.0) / 0.8) * (1 - smooth((t - 278.0) / 1.0));
      const pushDown = Math.max(introActive, outroActive);
      baseY = H * (0.50 + 0.14 * pushDown);
    }

    ctx.save();
    ctx.translate(W * 0.5 + (item.offsetX || 0), baseY + (item.offsetY || 0));
    ctx.scale(item.scale || 1, item.scale || 1);
    const visibleOpacity = clamp(item.opacity ?? 1, 0, 1);
    ctx.globalAlpha = visibleOpacity;

    const mainColor = data.textColor || '#ffffff';
    const glowColor = seg.accentColor || data.accentColor || '#ffffff';
    const glowAmount = clamp(Number(data.glow ?? 68) / 100, 0, 1.5);
    const pulse = data.beatEffect?.enabled ? beatPulse(t) : 0;

    if (art.wordLayout && art.wordLayout.length > 0) {
      const textCenterOffset = -art.totalWidth / 2 + art.textWidth / 2;
      ctx.save();
      ctx.translate(textCenterOffset, 0);
      ctx.font = `${fontWeight()} ${art.size}px ${fontFamily()}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';

      for (let i = 0; i < art.wordLayout.length; i++) {
        const w = art.wordLayout[i];
        const isCurrent = t >= w.start && t < w.end;
        const isSung = t >= w.end;

        ctx.save();
        if (isCurrent) {
          const wProg = clamp((t - w.start) / Math.max(0.08, w.end - w.start), 0, 1);
          const wave = Math.sin(wProg * Math.PI);
          const lift = -3.4 * wave - 2.2 * pulse;
          const wordScale = 1 + 0.048 * wave + 0.028 * pulse;
          const wordCenterX = w.x + w.width / 2;

          ctx.translate(wordCenterX, lift);
          ctx.scale(wordScale, wordScale);
          ctx.translate(-wordCenterX, 0);

          // Luminous aura glow around current word synced with beat
          ctx.shadowColor = glowColor;
          ctx.shadowBlur = (24 + 14 * wave + 16 * pulse) * Math.max(0.4, glowAmount);
          ctx.shadowOffsetY = 0;
          ctx.fillStyle = mainColor;
          ctx.fillText(w.text, w.x, 0);

          // Crisp core with deep contrast shadow
          ctx.shadowColor = 'rgba(0, 0, 0, 0.94)';
          ctx.shadowBlur = 7;
          ctx.shadowOffsetY = 2;
          ctx.fillStyle = '#ffffff';
          ctx.fillText(w.text, w.x, 0);

          // Animated beat-synced karaoke underline bar under the active word
          const barW = Math.max(6, w.width * clamp(wProg * 1.15, 0.15, 1));
          const barY = art.size * 0.54;
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#fef08a';
          ctx.beginPath();
          ctx.roundRect(w.x, barY, barW, 4, 2);
          ctx.fill();
        } else if (isSung) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
          ctx.fillText(w.text, w.x, 2.5);
          ctx.fillStyle = mainColor;
          ctx.fillText(w.text, w.x, 0);
        } else {
          ctx.globalAlpha = visibleOpacity * 0.72;
          ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
          ctx.fillText(w.text, w.x, 2.5);
          ctx.fillStyle = mainColor;
          ctx.fillText(w.text, w.x, 0);
        }
        ctx.restore();
      }
      ctx.restore();
    } else if (art.text) {
      const x = -art.totalWidth / 2 + art.textWidth / 2;
      ctx.drawImage(art.text, x - art.text.displayWidth / 2, -art.text.displayHeight / 2, art.text.displayWidth, art.text.displayHeight);
    }

    if (art.symbol) {
      const x = art.totalWidth / 2 - art.iconWidth / 2;
      const floatY = Math.sin(t * 2.4 + Number(seg.start || 0)) * 3.0 - pulse * 4.5;
      const iconScale = 1 + 0.035 * Math.sin(t * 2.8 + Number(seg.start || 0)) + pulse * 0.08;
      ctx.save();
      ctx.translate(x, floatY);
      ctx.scale(iconScale, iconScale);
      ctx.shadowColor = 'rgba(0, 0, 0, 0.88)';
      ctx.shadowBlur = 8;
      ctx.drawImage(art.symbol, -art.symbol.displayWidth / 2, -art.symbol.displayHeight / 2, art.symbol.displayWidth, art.symbol.displayHeight);
      ctx.restore();
    }
    ctx.restore();
  }

  // 2026-11-07: Khách hàng cần chèn ảnh hoặc ảnh GIF tách nền vào video, kéo di chuyển & chỉnh kích thước trực tiếp trên màn hình canvas, đồng thời chọn hiển thị xuyên suốt video hoặc chỉ trong khoảng thời gian chỉ định; giải mã từng frame GIF qua ImageDecoder + hỗ trợ tách nền màu tự động (chroma key) và ẩn khung chọn khi đang ghi hình xuất video.
  function hexToRgb(hex) {
    const clean = String(hex || '#ffffff').replace('#', '');
    const num = parseInt(clean.length === 3 ? clean.replace(/(.)/g, '$1$1') : clean, 16) || 0xffffff;
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }

  function rgbToHex(r, g, b) {
    return (
      '#' +
      [r, g, b]
        .map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0'))
        .join('')
    );
  }

  function sampleCornerColor(source, w, h) {
    try {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.min(64, w));
      c.height = Math.max(1, Math.min(64, h));
      const cctx = c.getContext('2d');
      cctx.drawImage(source, 0, 0, c.width, c.height);
      const px = cctx.getImageData(0, 0, 1, 1).data;
      return { hex: rgbToHex(px[0], px[1], px[2]), alpha: px[3] };
    } catch (e) {
      return { hex: '#ffffff', alpha: 255 };
    }
  }

  function applyChromaCanvas(srcCanvas, bgColor, tolerance) {
    const w = srcCanvas.width || srcCanvas.naturalWidth || 1;
    const h = srcCanvas.height || srcCanvas.naturalHeight || 1;
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const octx = out.getContext('2d');
    octx.drawImage(srcCanvas, 0, 0, w, h);
    try {
      const imgData = octx.getImageData(0, 0, w, h);
      const d = imgData.data;
      const target = hexToRgb(bgColor);
      const thresh = (Number(tolerance) || 32) * 2.55;
      const feather = Math.max(12, thresh * 0.38);
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        const dr = d[i] - target.r;
        const dg = d[i + 1] - target.g;
        const db = d[i + 2] - target.b;
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);
        if (dist <= thresh) {
          d[i + 3] = 0;
        } else if (dist < thresh + feather) {
          const factor = (dist - thresh) / feather;
          d[i + 3] = Math.round(d[i + 3] * factor);
        }
      }
      octx.putImageData(imgData, 0, 0);
    } catch (e) {
      /* ignore security/canvas errors */
    }
    return out;
  }

  // 2026-11-07: Khách hàng cần chèn thêm lớp Văn bản (chữ mở đầu / Intro, tên bài hát, ca sĩ) hoạt động giống hệt lớp GIF: chỉnh được font chữ, kích thước (kéo 4 góc trên màn hình hoặc thanh trượt), màu chữ/màu phát sáng và hẹn giờ xuất hiện; bổ sung nhánh type === 'text' trong bộ đo khung getStickerBox và bộ vẽ drawStickers.
  function getStickerFontSpec(fontKey) {
    if(fontKey==='poetic') return {family:"'Lora',Georgia,serif",weight:'500',upper:false};
    if (fontKey === 'oswald') return { family: `'Oswald','Be Vietnam Pro','Segoe UI',Arial,sans-serif`, weight: '700', upper: true };
    if (fontKey === 'elegant') return { family: `'Playfair Display',Georgia,serif`, weight: '700', upper: false };
    if (fontKey === 'modern') return { family: `'DM Sans','Be Vietnam Pro',sans-serif`, weight: '800', upper: false };
    return { family: `'Be Vietnam Pro','Segoe UI',Arial,sans-serif`, weight: '800', upper: false };
  }

  function getTextStickerLines(st) {
    const raw = String(st.text || '').trim();
    const fallback = recording() ? '' : 'Nhập văn bản mở đầu...';
    const content = raw || fallback;
    if (!content) return [];
    const spec = getStickerFontSpec(st.font);
    const formatted = spec.upper ? content.toLocaleUpperCase('vi-VN') : content;
    return formatted.split(/\r?\n/).slice(0, 6);
  }

  function measureTextSticker(st) {
    const lines = getTextStickerLines(st);
    const basePx = 64;
    const spec = getStickerFontSpec(st.font);
    ctx.save();
    ctx.font = `${spec.weight} ${basePx}px ${spec.family}`;
    let maxW = 140;
    for (const line of lines) {
      maxW = Math.max(maxW, ctx.measureText(line || ' ').width);
    }
    ctx.restore();
    const lineH = basePx * 1.32;
    st.baseW = Math.round(maxW + 44);
    st.baseH = Math.round(Math.max(1, lines.length) * lineH + 28);
    return { lines, basePx, lineH, spec };
  }

  function isStickerVisible(st, t) {
    if (!st) return false;
    if (st.alwaysOn) return true;
    return t >= st.start && t <= st.end;
  }

  function getStickerBox(st) {
    if (st.type === 'text') {
      measureTextSticker(st);
    }
    const w = st.baseW * st.scale;
    const h = st.baseH * st.scale;
    const left = st.x - w / 2;
    const right = st.x + w / 2;
    const top = st.y - h / 2;
    const bottom = st.y + h / 2;
    return {
      x: st.x,
      y: st.y,
      w,
      h,
      left,
      right,
      top,
      bottom,
      corners: {
        nw: { x: left, y: top },
        ne: { x: right, y: top },
        se: { x: right, y: bottom },
        sw: { x: left, y: bottom }
      }
    };
  }

  function getStickerRenderSource(st, t) {
    const key = `${st.removeBg ? 1 : 0}:${st.bgColor}:${st.tolerance}`;
    if (st._chromaKey !== key) {
      st._chromaKey = key;
      st._processedStatic = null;
      if (st.frames && st.frames.length) {
        for (const f of st.frames) f.processed = null;
      }
    }

    if (st.frames && st.frames.length > 0) {
      const loopDur = Math.max(0.05, st.totalGifDuration || 1);
      const localT = ((t % loopDur) + loopDur) % loopDur;
      let acc = 0;
      let picked = st.frames[0];
      for (const f of st.frames) {
        acc += f.duration;
        if (localT <= acc) {
          picked = f;
          break;
        }
      }
      if (!st.removeBg) return picked.canvas;
      if (!picked.processed) {
        picked.processed = applyChromaCanvas(picked.canvas, st.bgColor, st.tolerance);
      }
      return picked.processed;
    }

    if (!st.img) return null;
    if (!st.removeBg) return st.img;
    if (!st._processedStatic) {
      st._processedStatic = applyChromaCanvas(st.img, st.bgColor, st.tolerance);
    }
    return st._processedStatic;
  }

  function drawStickers(t, targetLayer) {
    for (const st of stickers) {
      if ((st.layer || 'front') !== targetLayer) continue;
      if (!isStickerVisible(st, t)) continue;

      const duration = Math.max(0.01, (st.alwaysOn ? totalTime() : st.end) - (st.alwaysOn ? 0 : st.start));
      const effectLen = Math.min(Number(st.effectDuration) || 0.45, duration / 2);
      const incoming = clamp((t - (st.alwaysOn ? 0 : st.start)) / effectLen);
      const outgoing = clamp(((st.alwaysOn ? totalTime() : st.end) - t) / effectLen);
      const enter = st.type === 'text' ? st.effectIn || 'fade' : 'fade';
      const leave = st.type === 'text' ? st.effectOut || 'fade' : 'fade';
      const timeFade = st.type !== 'text' && st.alwaysOn ? 1 : Math.min(enter === 'none' ? 1 : incoming, leave === 'none' ? 1 : outgoing);
      const motionY = (enter === 'slide' ? (1 - smooth(incoming)) * 80 : 0) - (leave === 'slide' ? (1 - smooth(outgoing)) * 80 : 0);
      const zoom = (enter === 'zoom' ? 0.6 + 0.4 * outCubic(incoming) : 1) * (leave === 'zoom' ? 0.6 + 0.4 * smooth(outgoing) : 1);
      const baseAlpha = clamp((Number(st.opacity) || 100) / 100, 0.05, 1) * timeFade;
      if (baseAlpha <= 0.005) continue;

      if (st.type === 'text') {
        const raw = String(st.text || '').trim();
        if (!raw && recording()) continue;
        const { lines, basePx, lineH, spec } = measureTextSticker(st);
        if (!lines.length) continue;

        ctx.save();
        ctx.translate(st.x, st.y + motionY);
        // Keep overlay text steady while the background reacts to the beat.
        ctx.scale(Math.max(0.05, st.scale) * zoom, Math.max(0.05, st.scale) * zoom);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${spec.weight} ${basePx}px ${spec.family}`;

        const isPlaceholder = !raw;
        for (let i = 0; i < lines.length; i++) {
          const ly = (i - (lines.length - 1) / 2) * lineH;
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#050816';
          ctx.globalAlpha = baseAlpha * (isPlaceholder ? 0.28 : 0.48);
          ctx.fillText(lines[i], 2, ly + 4);

          ctx.shadowColor = st.glowColor || '#a78bfa';
          ctx.shadowBlur = isPlaceholder ? 8 : 24;
          ctx.globalAlpha = baseAlpha * (isPlaceholder ? 0.55 : 1);
          ctx.fillStyle = st.textColor || '#ffffff';
          ctx.fillText(lines[i], 0, ly);
        }
        ctx.shadowBlur = 0;
        ctx.restore();
        continue;
      }

      const src = getStickerRenderSource(st, t);
      if (!src) continue;
      const box = getStickerBox(st);
      ctx.save();
      ctx.globalAlpha = baseAlpha;
      ctx.drawImage(src, box.left, box.top, box.w, box.h);
      ctx.restore();
    }
  }

  function drawStickerSelection(t) {
    if (!selectedStickerId || recording()) return;
    const st = stickers.find((x) => String(x.id) === String(selectedStickerId));
    if (!st || !isStickerVisible(st, t)) return;
    const box = getStickerBox(st);

    ctx.save();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.strokeRect(box.left, box.top, box.w, box.h);
    ctx.setLineDash([]);

    const handleRadius = 7;
    for (const pt of Object.values(box.corners)) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, handleRadius, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#8b5cf6';
      ctx.stroke();
    }
    ctx.restore();
  }

  async function decodeAnimatedFrames(file) {
    if (!('ImageDecoder' in window)) return null;
    const mime = file.type || (file.name.toLowerCase().endsWith('.gif') ? 'image/gif' : '');
    if (!mime.includes('gif') && !mime.includes('webp')) return null;
    try {
      const supported = await ImageDecoder.isTypeSupported(mime);
      if (!supported) return null;
      const buf = await file.arrayBuffer();
      const decoder = new ImageDecoder({ data: buf, type: mime });
      await decoder.tracks.ready;
      const track = decoder.tracks.selectedTrack;
      const count = track ? track.frameCount : 0;
      if (!count || count <= 1) {
        decoder.close();
        return null;
      }
      const frames = [];
      let totalGifDuration = 0;
      const maxFrames = Math.min(count, 180);
      for (let i = 0; i < maxFrames; i++) {
        const res = await decoder.decode({ frameIndex: i });
        const vf = res.image;
        const fw = vf.displayWidth || vf.codedWidth || 200;
        const fh = vf.displayHeight || vf.codedHeight || 200;
        const fc = document.createElement('canvas');
        fc.width = fw;
        fc.height = fh;
        fc.getContext('2d').drawImage(vf, 0, 0, fw, fh);
        const durSec = Math.max(0.02, (vf.duration || 80000) / 1e6);
        vf.close();
        frames.push({ canvas: fc, processed: null, duration: durSec });
        totalGifDuration += durSec;
      }
      decoder.close();
      return { frames, totalGifDuration };
    } catch (e) {
      return null;
    }
  }

  function addTextOverlay(entry = {}, opts = {}) {
    const startT = Number.isFinite(entry.start) ? entry.start : Math.max(0, Math.floor(time() * 10) / 10);
    const endT = Number.isFinite(entry.end) ? entry.end : Math.max(startT + 4.5, 4.5);
    const rawText = typeof entry.text === 'string' ? entry.text : '';
    const firstLine = rawText.trim().split(/\r?\n/)[0] || 'Văn bản mở đầu';
    const offset = (stickers.length % 4) * 24;

    const st = {
      id: entry.id || Date.now() + Math.random(),
      type: 'text',
      effectIn: entry.effectIn || 'fade',
      effectOut: entry.effectOut || 'fade',
      effectDuration: Number(entry.effectDuration) || 0.45,
      name: entry.name || firstLine,
      text: rawText,
      font: ['oswald', 'vietnam', 'elegant', 'modern', 'poetic'].includes(entry.font) ? entry.font : data.font || 'oswald',
      textColor: entry.textColor || '#ffffff',
      glowColor: entry.glowColor || data.accentColor || '#a78bfa',
      baseW: 360,
      baseH: 110,
      x: Number.isFinite(entry.x) ? entry.x : Math.round(W * 0.5),
      y: Number.isFinite(entry.y) ? entry.y : Math.round(H * 0.42 + offset),
      scale: Number.isFinite(entry.scale) ? entry.scale : 1,
      opacity: Number.isFinite(entry.opacity) ? entry.opacity : 100,
      layer: entry.layer === 'behind' ? 'behind' : 'front',
      alwaysOn: entry.alwaysOn !== undefined ? Boolean(entry.alwaysOn) : false,
      start: startT,
      end: endT
    };
    measureTextSticker(st);
    stickers.push(st);
    selectedStickerId = String(st.id);

    if (!opts.deferRender) {
      buildStickerList();
      draw(time());
      const ta = document.querySelector(`[data-sticker-id="${st.id}"] [data-sticker-field="text"]`);
      if (ta && !opts.skipSave) ta.focus();
    }
    if (!opts.skipSave) {
      persistStickers();
      persist();
      toast('Đã thêm lớp Văn bản. Nhập chữ, chọn font/kích thước hoặc kéo trực tiếp trên màn hình.');
    }
    return st;
  }

  async function addStickerFiles(fileList, opts = {}) {
    const items = Array.from(fileList || []);
    if (!items.length) return;

    for (let idx = 0; idx < items.length; idx++) {
      const entry = items[idx];
      if (entry && entry.type === 'text') {
        addTextOverlay(entry, { skipSave: true, deferRender: true });
        continue;
      }
      const file = entry.blob || entry;
      if (!file || !(file instanceof Blob)) continue;
      const name = entry.name || file.name || `sticker-${idx + 1}.png`;
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      const mount = $('stickerDomMount');
      if (mount) mount.appendChild(img);

      await new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = resolve;
      });

      const nw = Math.max(16, img.naturalWidth || 220);
      const nh = Math.max(16, img.naturalHeight || 220);
      const maxSide = 250;
      const ratio = Math.min(maxSide / nw, maxSide / nh, 1.5);
      const baseW = Math.round(nw * ratio);
      const baseH = Math.round(nh * ratio);

      const anim = await decodeAnimatedFrames(file);
      const sampleSrc = anim && anim.frames.length ? anim.frames[0].canvas : img;
      const corner = sampleCornerColor(sampleSrc, nw, nh);

      const offset = (stickers.length % 4) * 28;
      const st = {
        id: entry.id || Date.now() + Math.random() + idx,
        type: 'image',
        name,
        blob: file,
        isGif: Boolean(anim && anim.frames.length > 1) || name.toLowerCase().endsWith('.gif'),
        url,
        img,
        frames: anim ? anim.frames : null,
        totalGifDuration: anim ? anim.totalGifDuration : 0,
        naturalW: nw,
        naturalH: nh,
        baseW,
        baseH,
        x: Number.isFinite(entry.x) ? entry.x : Math.round(W * 0.78 - offset),
        y: Number.isFinite(entry.y) ? entry.y : Math.round(H * 0.34 + offset),
        scale: Number.isFinite(entry.scale) ? entry.scale : 1,
        opacity: Number.isFinite(entry.opacity) ? entry.opacity : 100,
        layer: entry.layer === 'behind' ? 'behind' : 'front',
        alwaysOn: entry.alwaysOn !== undefined ? Boolean(entry.alwaysOn) : true,
        start: Number.isFinite(entry.start) ? entry.start : Math.max(0, Math.floor(time() * 10) / 10),
        end: Number.isFinite(entry.end) ? entry.end : Math.max(4, Math.round(totalTime() * 10) / 10),
        effectIn: entry.effectIn || 'fade',
        effectOut: entry.effectOut || 'fade',
        effectDuration: Number.isFinite(entry.effectDuration) ? entry.effectDuration : 0.6,
        removeBg: Boolean(entry.removeBg),
        bgColor: entry.bgColor || corner.hex,
        tolerance: Number.isFinite(entry.tolerance) ? entry.tolerance : 32
      };
      stickers.push(st);
      selectedStickerId = String(st.id);
    }

    buildStickerList();
    draw(time());
    if (!opts.skipSave) {
      persistStickers();
      persist();
      toast(`Đã chèn ${items.length} ảnh/GIF. Kéo trực tiếp trên màn hình để đổi vị trí & kích thước.`);
    }
  }

  function buildStickerList() {
    const countEl = $('stickerCount');
    const pagBar = $('stickerPaginationBar');
    const pagEl = $('stickerPagination');
    const listEl = $('stickerList');
    if (!listEl) return;

    if (countEl) countEl.textContent = `${String(stickers.length).padStart(2, '0')} lớp`;

    if (!stickers.length) {
      selectedStickerId = null;
      if (pagBar) pagBar.classList.add('hidden');
      listEl.innerHTML = `<div class="sticker-empty">Chưa có lớp phủ nào. Bấm <b>+ Văn bản</b> (làm đoạn mở đầu) hoặc <b>+ Ảnh / GIF</b> rồi kéo trên màn hình.</div>`;
      return;
    }

    const activeSt =
      stickers.find((s) => String(s.id) === String(selectedStickerId)) || stickers[stickers.length - 1];
    const activeIdStr = String(activeSt.id);

    if (pagBar) pagBar.classList.remove('hidden');
    if (pagEl) {
      pagEl.innerHTML = stickers
        .map((st, idx) => {
          const isSel = String(st.id) === activeIdStr;
          const badge = st.type === 'text' ? `T${idx + 1}` : `${idx + 1}`;
          return `<button type="button" class="page-btn${isSel ? ' is-selected' : ''}" data-sticker-page="${st.id}" title="${escapeHtml(st.name || 'Lớp phủ')}">${badge}</button>`;
        })
        .join('');
    }

    const pageIdx = stickers.findIndex((s) => String(s.id) === activeIdStr) + 1;
    const scalePct = Math.round(activeSt.scale * 100);
    const isText = activeSt.type === 'text';
    const fontPx = Math.round(64 * activeSt.scale);

    const thumbHtml = isText
      ? `<div class="sticker-thumb-wrap sticker-thumb-text">Aa</div>`
      : `<div class="sticker-thumb-wrap"><img src="${activeSt.url}" alt="" /></div>`;

    const subText = isText
      ? `Văn bản nổi (${fontPx}px) · Kéo trên màn hình hoặc chỉnh 4 góc để đổi cỡ chữ`
      : `${activeSt.isGif ? 'GIF động' : 'Ảnh tĩnh'} · Kéo trên màn hình hoặc chỉnh góc để phóng to/thu nhỏ`;

    const effectOptions = value => Object.entries({none: 'Không hiệu ứng', fade: 'Mờ dần', slide: 'Trượt', zoom: 'Thu phóng'}).map(([key,label]) => `<option value="${key}" ${value === key ? 'selected' : ''}>${label}</option>`).join('');
    const effectControls = `<div class="text-effect-controls"><label>Xuất hiện<select class="select" data-sticker-field="effectIn">${effectOptions(activeSt.effectIn || 'fade')}</select></label><label>Biến mất<select class="select" data-sticker-field="effectOut">${effectOptions(activeSt.effectOut || 'fade')}</select></label><label>Thời lượng (giây)<input class="input" type="number" min="0.1" max="3" step="0.05" data-sticker-field="effectDuration" value="${activeSt.effectDuration || 0.45}" /></label></div>`;
    const textSpecificHtml = isText
      ? `${effectControls}<textarea class="textarea sticker-text-editor" data-sticker-field="text" placeholder="Nhập văn bản mở đầu, tên bài hát, ca sĩ...">${escapeHtml(activeSt.text || '')}</textarea>
      <div class="sticker-text-style-row">
        <select class="select" data-sticker-field="font" title="Font chữ văn bản" style="padding:6px 24px 6px 9px;font-size:10.5px">
          <option value="oswald" ${activeSt.font === 'oswald' ? 'selected' : ''}>Oswald Poster (Hoa)</option>
          <option value="vietnam" ${activeSt.font === 'vietnam' ? 'selected' : ''}>Be Vietnam Pro</option>
          <option value="elegant" ${activeSt.font === 'elegant' ? 'selected' : ''}>Playfair Display</option>
          <option value="modern" ${activeSt.font === 'modern' ? 'selected' : ''}>DM Sans Modern</option>
        </select>
        <label class="sticker-color-chip" title="Màu chữ">
          <span>Màu chữ</span>
          <input type="color" class="mini-color" data-sticker-field="textColor" value="${activeSt.textColor || '#ffffff'}" style="width:22px;height:22px" />
        </label>
        <label class="sticker-color-chip" title="Màu viền phát sáng">
          <span>Phát sáng</span>
          <input type="color" class="mini-color" data-sticker-field="glowColor" value="${activeSt.glowColor || '#a78bfa'}" style="width:22px;height:22px" />
        </label>
      </div>`
      : '';

    const chromaHtml = !isText
      ? `<div class="sticker-chroma-row">
        <label class="sticker-check">
          <input type="checkbox" data-sticker-field="removeBg" ${activeSt.removeBg ? 'checked' : ''} />
          <span>Tách nền màu</span>
        </label>
        <div class="sticker-chroma-controls ${activeSt.removeBg ? '' : 'hidden'}" data-role="chromaControls">
          <input type="color" class="mini-color" data-sticker-field="bgColor" value="${activeSt.bgColor}" title="Màu nền cần tách" style="width:24px;height:24px" />
          <input class="range" type="range" min="5" max="90" step="1" data-sticker-field="tolerance" value="${activeSt.tolerance}" title="Độ nhạy tách nền" />
        </div>
      </div>`
      : '';

    listEl.innerHTML = `<div class="sticker-card" data-sticker-id="${activeSt.id}">
      <div class="sticker-head">
        ${thumbHtml}
        <div class="sticker-meta">
          <div class="sticker-name" data-role="stickerName">#${pageIdx} · ${escapeHtml(activeSt.name || 'Văn bản mở đầu')}</div>
          <div class="sticker-sub" data-role="stickerSub">${subText}</div>
        </div>
        <button class="lyric-action" type="button" data-sticker-action="center" title="Đưa về giữa khung">⌖</button>
        <button class="lyric-action" type="button" data-sticker-action="remove" title="Xóa lớp này">×</button>
      </div>

      ${textSpecificHtml}

      <div class="sticker-grid">
        <div class="sticker-box">
          <div class="sticker-box-head"><span>${isText ? 'Cỡ chữ' : 'Kích thước'}</span><b data-sticker-val="scale">${isText ? `${fontPx}px (${scalePct}%)` : `${scalePct}%`}</b></div>
          <input class="range" type="range" min="20" max="300" step="2" data-sticker-field="scale" value="${scalePct}" />
        </div>
        <div class="sticker-box">
          <div class="sticker-box-head"><span>Độ rõ</span><b data-sticker-val="opacity">${activeSt.opacity}%</b></div>
          <input class="range" type="range" min="10" max="100" step="2" data-sticker-field="opacity" value="${activeSt.opacity}" />
        </div>
        <div class="sticker-box">
          <div class="sticker-box-head"><span>Lớp hiển thị</span></div>
          <select class="select" data-sticker-field="layer" style="padding:4px 22px 4px 7px;font-size:10px">
            <option value="front" ${activeSt.layer === 'front' ? 'selected' : ''}>Trên lời hát</option>
            <option value="behind" ${activeSt.layer === 'behind' ? 'selected' : ''}>Dưới lời hát</option>
          </select>
        </div>
      </div>

      <div class="sticker-row">
        <div class="sticker-mode-pills">
          <button type="button" class="sticker-pill ${activeSt.alwaysOn ? 'active' : ''}" data-sticker-action="setAlways" data-val="1">Xuyên suốt video</button>
          <button type="button" class="sticker-pill ${!activeSt.alwaysOn ? 'active' : ''}" data-sticker-action="setAlways" data-val="0">Chọn thời gian</button>
        </div>
        <div class="sticker-time-inputs ${activeSt.alwaysOn ? 'hidden' : ''}" data-role="stickerTimeBox">
          <div class="time-input-row">
            <input class="input" data-sticker-field="start" value="${secText(activeSt.start)}" title="Bắt đầu hiện" />
            <button class="time-capture" type="button" data-sticker-action="captureStart" title="Lấy mốc hiện tại">⊙</button>
          </div>
          <span style="color:#64748b;font-size:10px">→</span>
          <div class="time-input-row">
            <input class="input" data-sticker-field="end" value="${secText(activeSt.end)}" title="Kết thúc hiện" />
            <button class="time-capture" type="button" data-sticker-action="captureEnd" title="Lấy mốc hiện tại">⊙</button>
          </div>
        </div>
      </div>

      ${chromaHtml}
    </div>`;
  }

  // 2026-11-16: Khách hàng phản hồi video xuất ra đăng lên YouTube chỉ tối đa được 720p mà không lên được 1080p; trước đó sizePreviewCanvas(true) đặt độ phân giải xuất là 1600×900 (nhỏ hơn chuẩn 1920×1080 nên bị YouTube hạ xuống bậc 720p) và thiếu khóa contentHint="detail" cùng bitrate 12Mbps cho Full HD, nên nâng độ phân giải xuất cố định lên 1920×1080 (EXPORT_W × EXPORT_H) và khóa không cho resize làm tụt độ phân giải khi đang ghi hình.
  let isExporting = false;
  function sizePreviewCanvas(fullSize = false) {
    if ((recording() || isExporting) && !fullSize) return;
    const shownWidth = canvas.getBoundingClientRect().width || W;
    const width = fullSize
      ? EXPORT_W
      : Math.min(W, Math.max(800, Math.ceil((shownWidth * Math.min(window.devicePixelRatio || 1, 1.25)) / 16) * 16));
    const height = fullSize ? EXPORT_H : Math.round((width * H) / W);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      draw(time());
    }
  }
  let previewResizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(previewResizeTimer);
    previewResizeTimer=setTimeout(()=>sizePreviewCanvas(),120);
  });

  let lastDrawnTime = NaN;
  // 2026-11-15: Khách hàng phản hồi hiệu ứng tự zoom lớn nhỏ rất khó chịu; trước đó draw(t) tính cameraScale nhấp nhô theo beatPulse(t)*.025 trên mỗi nhịp trống làm toàn bộ khung cảnh phóng to thu nhỏ liên tục, nên bỏ cameraScale để giữ khung hình ổn định tuyệt đối.
  function draw(t) {
    lastDrawnTime = t;
    ctx.setTransform(canvas.width/W, 0, 0, canvas.height/H, 0, 0);
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    drawBackground(t);
    drawWeather(t);
    drawBeatAccents(t);
    drawInstrumental(t);
    drawIntro(t);
    drawStickers(t, 'behind');
    drawWords(t);
    drawStickers(t, 'front');
    drawStickerSelection(t);
    ctx.restore();
  }

  // 2026-11-16: Khách hàng phản hồi khi đang xuất video mà chuyển sang tab khác trên Chrome để xem thì video xuất ra bị đơ; nguyên nhân do Chrome tạm dừng requestAnimationFrame và hoãn flush GPU 2D Canvas khi tab bị ẩn (document.hidden). Khắc phục bằng cách kết hợp Web Worker 30fps + xung nhịp AudioContext ScriptProcessorNode (không bao giờ bị Chrome khóa khi có nhạc) + ép flush GPU bằng getImageData(0,0,1,1) và requestFrame() khi tab ẩn.
  let exportWorker = null;
  let exportAudioTicker = null;
  let exportWakeLock = null;
  let lastRecordDrawStamp = 0;

  function startExportBackgroundTicker() {
    stopExportBackgroundTicker();
    try {
      const blob = new Blob(
        ['let id=setInterval(()=>postMessage(Date.now()),33);onmessage=e=>{if(e.data==="stop")clearInterval(id);}'],
        { type: 'application/javascript' }
      );
      exportWorker = new Worker(URL.createObjectURL(blob));
      exportWorker.onmessage = () => {
        if (recording() && (document.hidden || performance.now() - lastRecordDrawStamp >= 32)) {
          loop(performance.now(), true);
        }
      };
    } catch (e) {}
    try {
      ensureAudioContextSync();
      const proc = audioContext.createScriptProcessor(2048, 1, 1);
      proc.onaudioprocess = () => {
        if (recording() && (document.hidden || performance.now() - lastRecordDrawStamp >= 33)) {
          loop(performance.now(), true);
        }
      };
      proc.connect(audioContext.destination);
      exportAudioTicker = proc;
    } catch (e) {}
    if (navigator.wakeLock && navigator.wakeLock.request) {
      navigator.wakeLock.request('screen').then((wl) => { exportWakeLock = wl; }).catch(() => {});
    }
  }

  function stopExportBackgroundTicker() {
    if (exportWorker) {
      try {
        exportWorker.postMessage('stop');
        exportWorker.terminate();
      } catch (e) {}
      exportWorker = null;
    }
    if (exportAudioTicker) {
      try {
        exportAudioTicker.onaudioprocess = null;
        exportAudioTicker.disconnect();
      } catch (e) {}
      exportAudioTicker = null;
    }
    if (exportWakeLock) {
      try { exportWakeLock.release(); } catch (e) {}
      exportWakeLock = null;
    }
  }

  function loop(stamp, fromWorker = false) {
    if (!lastStamp) lastStamp = stamp;
    const dt = Math.min(0.1, (stamp - lastStamp) / 1000);
    lastStamp = stamp;
    if (playing && !pcmReady && !audioReady && !ytReady) {
      demoTime += dt;
      if (demoTime >= totalTime()) {
        demoTime = 0;
        pause();
      }
    }
    const t = time();
    if (playing && pcmReady && pcmBuffer && t >= pcmBuffer.duration - 0.015) {
      if (recording()) {
        stopRecord();
      } else {
        pcmOffset = 0;
        pause();
      }
    }
    if (playing && previewSegEnd !== null && t >= previewSegEnd) {
      pause();
    }
    if (recording()) {
      if (stamp - lastRecordDrawStamp >= 30 || fromWorker) {
        lastRecordDrawStamp = stamp;
        draw(t);
        try {
          if (document.hidden) ctx.getImageData(0, 0, 1, 1);
          const vTrack = exportStream?.getVideoTracks?.()?.[0];
          if (vTrack && typeof vTrack.requestFrame === 'function') vTrack.requestFrame();
        } catch (e) {}
      }
    } else if (playing || t !== lastDrawnTime) {
      draw(t);
    }
    if (!document.hidden && Math.floor(stamp / 120) !== Math.floor((stamp - dt * 1000) / 120)) updateTransport(t);
    if (!fromWorker) requestAnimationFrame(loop);
  }

  function getCanvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / Math.max(1, rect.width)) * W,
      y: ((e.clientY - rect.top) / Math.max(1, rect.height)) * H
    };
  }

  function hitStickerHandle(st, pt) {
    const box = getStickerBox(st);
    for (const [key, corner] of Object.entries(box.corners)) {
      if (Math.hypot(pt.x - corner.x, pt.y - corner.y) <= 20) {
        return key;
      }
    }
    return null;
  }

  function hitStickerBody(pt, t) {
    for (let i = stickers.length - 1; i >= 0; i--) {
      const st = stickers[i];
      if (!isStickerVisible(st, t)) continue;
      const box = getStickerBox(st);
      if (pt.x >= box.left && pt.x <= box.right && pt.y >= box.top && pt.y <= box.bottom) {
        return st;
      }
    }
    return null;
  }

  // Control connections
  $('playBtn').addEventListener('click', togglePlay);
  $('overlayPlay').addEventListener('click', togglePlay);
  canvas.addEventListener('click', () => {
    if (canvasStickerInteracted) {
      canvasStickerInteracted = false;
      return;
    }
    togglePlay();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!stickers.length) {
      canvas.style.cursor = 'pointer';
      return;
    }
    const pt = getCanvasPoint(e);
    const t = time();
    const sel = stickers.find((s) => String(s.id) === String(selectedStickerId));
    if (sel && isStickerVisible(sel, t)) {
      const hKey = hitStickerHandle(sel, pt);
      if (hKey) {
        canvas.style.cursor = hKey === 'nw' || hKey === 'se' ? 'nwse-resize' : 'nesw-resize';
        return;
      }
    }
    if (hitStickerBody(pt, t)) {
      canvas.style.cursor = 'grab';
      return;
    }
    canvas.style.cursor = 'pointer';
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (!stickers.length) return;
    const pt = getCanvasPoint(e);
    const t = time();

    let targetSt = stickers.find((s) => String(s.id) === String(selectedStickerId));
    let handleKey = targetSt && isStickerVisible(targetSt, t) ? hitStickerHandle(targetSt, pt) : null;

    if (!handleKey) {
      targetSt = hitStickerBody(pt, t);
      if (!targetSt) {
        if (selectedStickerId) {
          selectedStickerId = null;
          draw(t);
        }
        return;
      }
    }

    e.preventDefault();
    canvasStickerInteracted = true;
    const prevSel = selectedStickerId;
    selectedStickerId = String(targetSt.id);
    if (String(prevSel) !== selectedStickerId) {
      buildStickerList();
    }

    const startX = pt.x;
    const startY = pt.y;
    const origX = targetSt.x;
    const origY = targetSt.y;
    const origScale = targetSt.scale;
    const origDist = Math.max(20, Math.hypot(startX - origX, startY - origY));

    const onMove = (ev) => {
      const cur = getCanvasPoint(ev);
      if (handleKey) {
        const newDist = Math.max(12, Math.hypot(cur.x - origX, cur.y - origY));
        targetSt.scale = clamp((origScale * newDist) / origDist, 0.2, 3.2);
        const scalePct = Math.round(targetSt.scale * 100);
        const fontPx = Math.round(64 * targetSt.scale);
        const card = document.querySelector(`[data-sticker-id="${targetSt.id}"]`);
        if (card) {
          const rng = card.querySelector('[data-sticker-field="scale"]');
          const lbl = card.querySelector('[data-sticker-val="scale"]');
          const sub = card.querySelector('[data-role="stickerSub"]');
          if (rng) rng.value = scalePct;
          if (lbl) lbl.textContent = targetSt.type === 'text' ? `${fontPx}px (${scalePct}%)` : scalePct + '%';
          if (sub && targetSt.type === 'text') {
            sub.textContent = `Văn bản nổi (${fontPx}px) · Kéo trên màn hình hoặc chỉnh 4 góc để đổi cỡ chữ`;
          }
        }
      } else {
        targetSt.x = clamp(Math.round(origX + (cur.x - startX)), 20, W - 20);
        targetSt.y = clamp(Math.round(origY + (cur.y - startY)), 20, H - 20);
        canvas.style.cursor = 'grabbing';
      }
      draw(time());
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      canvas.style.cursor = 'grab';
      persistStickers();
      setTimeout(() => {
        canvasStickerInteracted = false;
      }, 40);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });

  if ($('addTextOverlayBtn')) {
    $('addTextOverlayBtn').addEventListener('click', () => {
      addTextOverlay();
    });
  }
  if ($('stickerInput')) {
    $('stickerInput').addEventListener('change', (e) => {
      addStickerFiles(e.target.files);
      e.target.value = '';
    });
  }
  if ($('deselectStickerBtn')) {
    $('deselectStickerBtn').addEventListener('click', () => {
      selectedStickerId = null;
      draw(time());
    });
  }
  if ($('stickerPagination')) {
    $('stickerPagination').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-sticker-page]');
      if (!btn) return;
      selectedStickerId = btn.dataset.stickerPage;
      buildStickerList();
      draw(time());
    });
  }
  if ($('stickerList')) {
    $('stickerList').addEventListener('input', (e) => {
      const field = e.target.dataset.stickerField;
      if (!field) return;
      const card = e.target.closest('[data-sticker-id]');
      if (!card) return;
      const st = stickers.find((x) => String(x.id) === card.dataset.stickerId);
      if (!st) return;

      if (field === 'effectIn' || field === 'effectOut') {
        st[field] = e.target.value;
      } else if (field === 'effectDuration') {
        st.effectDuration = clamp(Number(e.target.value) || 0.45, 0.1, 3);
      } else if (field === 'text') {
        st.text = e.target.value;
        const firstLine = String(st.text || '').trim().split(/\r?\n/)[0] || 'Văn bản mở đầu';
        st.name = firstLine;
        const pageIdx = stickers.findIndex((s) => String(s.id) === String(st.id)) + 1;
        const nameEl = card.querySelector('[data-role="stickerName"]');
        if (nameEl) nameEl.textContent = `#${pageIdx} · ${st.name}`;
        const pagBtn = document.querySelector(`[data-sticker-page="${st.id}"]`);
        if (pagBtn) pagBtn.title = st.name;
      } else if (field === 'font') {
        st.font = e.target.value;
      } else if (field === 'textColor') {
        st.textColor = e.target.value;
      } else if (field === 'glowColor') {
        st.glowColor = e.target.value;
      } else if (field === 'scale') {
        const pct = Number(e.target.value) || 100;
        st.scale = clamp(pct / 100, 0.2, 3.2);
        const fontPx = Math.round(64 * st.scale);
        const lbl = card.querySelector('[data-sticker-val="scale"]');
        const sub = card.querySelector('[data-role="stickerSub"]');
        if (lbl) lbl.textContent = st.type === 'text' ? `${fontPx}px (${pct}%)` : pct + '%';
        if (sub && st.type === 'text') {
          sub.textContent = `Văn bản nổi (${fontPx}px) · Kéo trên màn hình hoặc chỉnh 4 góc để đổi cỡ chữ`;
        }
      } else if (field === 'opacity') {
        st.opacity = Number(e.target.value) || 100;
        const lbl = card.querySelector('[data-sticker-val="opacity"]');
        if (lbl) lbl.textContent = st.opacity + '%';
      } else if (field === 'layer') {
        st.layer = e.target.value;
      } else if (field === 'removeBg') {
        st.removeBg = e.target.checked;
        const box = card.querySelector('[data-role="chromaControls"]');
        if (box) box.classList.toggle('hidden', !st.removeBg);
      } else if (field === 'bgColor') {
        st.bgColor = e.target.value;
      } else if (field === 'tolerance') {
        st.tolerance = Number(e.target.value) || 32;
      }
      persistStickers();
      draw(time());
    });

    $('stickerList').addEventListener('change', (e) => {
      const field = e.target.dataset.stickerField;
      if (field !== 'start' && field !== 'end') return;
      const card = e.target.closest('[data-sticker-id]');
      if (!card) return;
      const st = stickers.find((x) => String(x.id) === card.dataset.stickerId);
      if (!st) return;
      const parsed = parseTime(e.target.value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        e.target.value = secText(st[field]);
        return;
      }
      st[field] = parsed;
      if (st.end <= st.start) st.end = st.start + 1;
      card.querySelector('[data-sticker-field="start"]').value = secText(st.start);
      card.querySelector('[data-sticker-field="end"]').value = secText(st.end);
      persistStickers();
      draw(time());
    });

    $('stickerList').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-sticker-action]');
      if (!btn) return;
      const card = btn.closest('[data-sticker-id]');
      if (!card) return;
      const idx = stickers.findIndex((x) => String(x.id) === card.dataset.stickerId);
      if (idx < 0) return;
      const st = stickers[idx];
      const act = btn.dataset.stickerAction;

      if (act === 'remove') {
        if (st.img && st.img.parentNode) st.img.remove();
        // Retain URL for undo until page unload.
        stickers.splice(idx, 1);
        selectedStickerId = stickers.length ? String(stickers[stickers.length - 1].id) : null;
        buildStickerList();
        persistStickers();
        draw(time());
      } else if (act === 'center') {
        st.x = Math.round(W * 0.5);
        st.y = Math.round(H * 0.5);
        persistStickers();
        draw(time());
      } else if (act === 'setAlways') {
        st.alwaysOn = btn.dataset.val === '1';
        buildStickerList();
        persistStickers();
        draw(time());
      } else if (act === 'captureStart') {
        st.start = Math.max(0, time());
        if (st.end <= st.start) st.end = st.start + 2;
        card.querySelector('[data-sticker-field="start"]').value = secText(st.start);
        card.querySelector('[data-sticker-field="end"]').value = secText(st.end);
        persistStickers();
        draw(time());
      } else if (act === 'captureEnd') {
        st.end = Math.max(st.start + 0.3, time());
        card.querySelector('[data-sticker-field="end"]').value = secText(st.end);
        persistStickers();
        draw(time());
      }
    });
  }
  $('seek').addEventListener('input', (e) => {
    previewSegId = null;
    previewSegEnd = null;
    setTime(Number(e.target.value));
  });
  if ($('sidePlayBtn')) $('sidePlayBtn').addEventListener('click', togglePlay);
  if ($('sideRewBtn')) $('sideRewBtn').addEventListener('click', () => setTime(time() - 2));
  if ($('sideFwdBtn')) $('sideFwdBtn').addEventListener('click', () => setTime(time() + 2));
  if ($('sideSeek')) {
    $('sideSeek').addEventListener('input', (e) => {
      previewSegId = null;
      previewSegEnd = null;
      setTime(Number(e.target.value));
    });
  }
  if ($('lyricPagination')) {
    $('lyricPagination').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-page-id]');
      if (!btn) return;
      selectedSegId = btn.dataset.pageId;
      buildList();
    });
  }
  $('prevBtn').addEventListener('click', () => {
    const starts = sortedLyrics().map((s) => s.start);
    const t = time();
    const previous = starts.filter((x) => x < t - 0.35);
    setTime(previous.length ? previous[previous.length - 1] : 0);
  });
  $('nextBtn').addEventListener('click', () => {
    const next = sortedLyrics().find((x) => x.start > time() + 0.05);
    if (next) setTime(next.start);
  });
  $('imageInput').addEventListener('change', (e) => useImage(e.target.files[0]));
  $('audioInput').addEventListener('change', (e) => useAudio(e.target.files[0]));
  $('copyAudioPathBtn')?.addEventListener('click', copyLoadedAudioPath);
  $('removeAudioBtn')?.addEventListener('click', () => removeAudio().catch(() => toast('Không thể gỡ bài hát.')));
  $('newProjectBtn')?.addEventListener('click', () => createNewProject().catch(() => toast('Không thể tạo dự án mới.')));
  $('agentPackageBtn')?.addEventListener('click', () => exportAgentPackage().catch(() => toast('Không thể xuất gói agent.')));
  $('libraryBtn')?.addEventListener('click', () => { $('libraryDialog')?.showModal(); refreshLibrary(); });
  $('cleanupSelectedBtn')?.addEventListener('click', cleanupLibrary);
  $('debugLogBtn')?.addEventListener('click', () => {
    const output = $('debugLogText');
    if (output) output.textContent = debugEntries.length ? debugEntries.join('\n') : 'Chưa có log.';
    $('debugDialog')?.showModal();
  });
  $('clearDebugLogBtn')?.addEventListener('click', () => {
    debugEntries = [];
    localStorage.removeItem(DEBUG_LOG_KEY);
    const output = $('debugLogText');
    if (output) output.textContent = 'Chưa có log.';
  });
  let debugSpaceTimer = 0;
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat || debugSpaceTimer) return;
    debugSpaceTimer = window.setTimeout(() => {
      debugSpaceTimer = 0;
      const output = $('debugLogText');
      if (output) output.textContent = debugEntries.length ? debugEntries.join('\n') : 'Chưa có log.';
      const dialog = $('debugDialog');
      if (dialog?.open) dialog.close();
      else dialog?.showModal();
    }, 10000);
  });
  window.addEventListener('keyup', (e) => {
    if (e.code !== 'Space' || !debugSpaceTimer) return;
    window.clearTimeout(debugSpaceTimer);
    debugSpaceTimer = 0;
  });
  window.addEventListener('blur', () => {
    if (debugSpaceTimer) window.clearTimeout(debugSpaceTimer);
    debugSpaceTimer = 0;
  });

  // YouTube import controls
  $('ytImportBtn').addEventListener('click', () => importYoutubeAudio($('ytUrlInput').value));
  $('ytUrlInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      importYoutubeAudio($('ytUrlInput').value);
    }
  });
  $('ytUrlInput').addEventListener('paste', (e) => {
    setTimeout(() => {
      const val = $('ytUrlInput').value.trim();
      if (extractYoutubeId(val)) {
        importYoutubeAudio(val);
      }
    }, 60);
  });
  $('useYtThumbBtn').addEventListener('click', applyYoutubeThumbnailAsBackground);

  audio.addEventListener('ended', () => {
    playing = false;
    setPlayingUI();
    if (recording()) stopRecord();
  });
  audio.addEventListener('pause', () => {
    if (!recording()) {
      playing = false;
      setPlayingUI();
    }
  });
  audio.addEventListener('play', () => {
    playing = true;
    setPlayingUI();
  });

  document.querySelectorAll('.weather').forEach((el) =>
    el.addEventListener('click', () => {
      data.weather = el.dataset.weather;
      document.querySelectorAll('.weather').forEach((x) => x.classList.toggle('selected', x === el));
      persist();
      draw(time());
    })
  );

  // 2026-11-15: Khách hàng phản hồi chỉnh hiệu ứng chung và gõ sửa lời bên phải không ăn vào lời trên màn hình; trước đó thiếu lắng nghe sự kiện cho #lyricModeSelect và khi gõ vào textarea data-field="text" thì mảng seg.words vẫn giữ chữ cũ, nên bổ sung lyricModeSelect vào bộ lắng nghe điều khiển chung và tự động đồng bộ lại seg.words + xóa cache lyricArtwork ngay khi gõ chữ.
  for (const prop of [
    'density',
    'dim',
    'fontSize',
    'glow',
    'fontSelect',
    'positionSelect',
    'directionSelect',
    'lyricModeSelect',
    'textColor',
    'accentColor'
  ]) {
    const el = $(prop);
    if (!el) continue;
    const onControlUpdate = () => {
      const name = {
        fontSelect: 'font',
        positionSelect: 'position',
        directionSelect: 'lyricDirection',
        lyricModeSelect: 'lyricMode'
      }[prop] || prop;
      data[name] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
      if (prop === 'lyricModeSelect' && Array.isArray(data.lyrics)) {
        for (const s of data.lyrics) s.mode = data.lyricMode;
      }
      if (['density', 'dim', 'glow'].includes(prop)) $(prop + 'Val').textContent = data[name] + '%';
      if (prop === 'fontSize') $('fontSizeVal').textContent = data.fontSize + ' px';
      lyricArtwork.clear();
      persist();
      draw(time());
    };
    el.addEventListener('input', onControlUpdate);
    el.addEventListener('change', onControlUpdate);
  }

  $('lyricList').addEventListener('input', (e) => {
    const field = e.target.dataset.field;
    if (!field) return;
    const item = e.target.closest('.lyric-item');
    const seg = data.lyrics.find((x) => String(x.id) === item.dataset.id);
    if (!seg) return;
    if (field === 'text' || field === 'mode' || field === 'icon') {
      seg[field] = e.target.value;
      if (field === 'text') {
        const rawIcon = seg.icon || seg.tag || '';
        const parts = NebulaMotion.textAndIcons(seg.text, rawIcon);
        if (parts.icon && !seg.icon) seg.icon = parts.icon;
        const tokens = parts.text.trim() ? parts.text.trim().split(/\s+/) : [];
        const oldWords = Array.isArray(seg.words) ? seg.words : [];
        const segDur = Math.max(0.2, (Number(seg.end) || 0) - (Number(seg.start) || 0));
        seg.words = tokens.map((tok, i) => {
          if (oldWords.length === tokens.length && oldWords[i]) {
            return { ...oldWords[i], word: tok };
          }
          const st = Number(seg.start) + (i / Math.max(1, tokens.length)) * segDur;
          const en = Number(seg.start) + ((i + 1) / Math.max(1, tokens.length)) * segDur;
          return {
            word: tok,
            start: Math.round(st * 100) / 100,
            end: Math.round(en * 100) / 100
          };
        });
      }
      lyricArtwork.clear();
      persist();
      draw(time());
      return;
    }
    if (field === 'timingIn' || field === 'timingMid' || field === 'timingOut') {
      seg[field] = Number(e.target.value);
      const valNode = item.querySelector(`[data-val="${field}"]`);
      if (valNode) valNode.textContent = seg[field].toFixed(2) + '×';
      persist();
      draw(time());
    }
  });

  function syncSortedOrderAndBadge(item, seg) {
    data.lyrics = sortedLyrics();
    const sorted = data.lyrics;
    renderScrubberSegments();
    renderPagination(sorted);
    if (item && seg) {
      const newPageNum = sorted.findIndex((s) => String(s.id) === String(seg.id)) + 1;
      const idxBadge = item.querySelector('.lyric-index');
      const timingTitle = item.querySelector('.seg-timing-head strong');
      if (idxBadge && newPageNum > 0) {
        idxBadge.textContent = `#${String(newPageNum).padStart(2, '0')} / ${String(sorted.length).padStart(2, '0')}`;
      }
      if (timingTitle && newPageNum > 0) {
        timingTitle.textContent = `Nhịp chuyển động #${newPageNum}`;
      }
    }
  }

  $('lyricList').addEventListener('change', (e) => {
    const field = e.target.dataset.field;
    if (!field) return;
    const item = e.target.closest('.lyric-item');
    const seg = data.lyrics.find((x) => String(x.id) === item.dataset.id);
    if (!seg) return;
    if (field === 'start' || field === 'end') {
      const next = parseTime(e.target.value);
      if (!Number.isFinite(next) || next < 0) {
        toast('Thời gian không hợp lệ, ví dụ 00:12.50');
        e.target.value = secText(seg[field]);
        return;
      }
      seg[field] = next;
      validSegment(seg);
      e.target.value = secText(seg[field]);
      const other = item.querySelector(`[data-field="${field === 'start' ? 'end' : 'start'}"]`);
      other.value = secText(seg[field === 'start' ? 'end' : 'start']);
      item.querySelector('.lyric-status').textContent = `${secText(seg.start)} – ${secText(seg.end)}`;
      syncSegmentTrackUI(item, seg, time());
      syncSortedOrderAndBadge(item, seg);
      activeId = null;
      highlightCurrent();
      persist();
      updateTransport(time());
    }
  });

  $('lyricList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-action]');
    if (!b) return;
    const item = b.closest('.lyric-item');
    const index = data.lyrics.findIndex((x) => String(x.id) === item.dataset.id);
    if (index < 0) return;
    const seg = data.lyrics[index];
    if (b.dataset.action === 'remove') {
      const sorted = sortedLyrics();
      const sortedIdx = sorted.findIndex((x) => String(x.id) === String(seg.id));
      data.lyrics.splice(index, 1);
      const nextSorted = sortedLyrics();
      if (nextSorted.length) {
        const pick = nextSorted[Math.min(sortedIdx, nextSorted.length - 1)];
        selectedSegId = String(pick.id);
      } else {
        selectedSegId = null;
      }
      activeId = null;
      buildList();
      persist();
      return;
    }
    if (b.dataset.action === 'duplicate') {
      const sorted = sortedLyrics();
      const curIdx = Math.max(0, sorted.findIndex((x) => String(x.id) === String(seg.id)));
      const nextSeg = sorted[curIdx + 1] || null;
      let start = seg.end + 0.15;
      let end = start + Math.max(2, seg.end - seg.start);
      if (nextSeg && nextSeg.start <= start) {
        start = Math.min(seg.end, nextSeg.start);
        end = Math.max(start + 0.5, Math.min(start + 3, nextSeg.end));
      }
      const newSeg = {
        ...seg,
        id: Date.now() + Math.random(),
        start,
        end
      };
      sorted.splice(curIdx + 1, 0, newSeg);
      data.lyrics = sorted;
      data.lyrics = sortedLyrics();
      selectedSegId = String(newSeg.id);
      activeId = null;
      buildList();
      persist();
      return;
    }
    if (b.dataset.action === 'setStart' || b.dataset.action === 'setEnd') {
      const field = b.dataset.action === 'setStart' ? 'start' : 'end';
      seg[field] = time();
      validSegment(seg);
      item.querySelector('[data-field=start]').value = secText(seg.start);
      item.querySelector('[data-field=end]').value = secText(seg.end);
      item.querySelector('.lyric-status').textContent = `${secText(seg.start)} – ${secText(seg.end)}`;
      syncSegmentTrackUI(item, seg, time());
      syncSortedOrderAndBadge(item, seg);
      persist();
      activeId = null;
      highlightCurrent();
      return;
    }
    if (b.dataset.action === 'playSegment') {
      const sid = String(seg.id);
      if (playing && previewSegId === sid) {
        pause();
        syncSegmentTrackUI(item, seg, time());
        return;
      }
      const previewLead = Math.max(0.45, Number(seg.timingIn) || 0.6);
      const previewTail = Math.max(0.45, Number(seg.timingOut) || 0.6);
      setTime(Math.max(0, seg.start - previewLead));
      previewSegId = sid;
      previewSegEnd = seg.end + previewTail;
      play();
      syncSegmentTrackUI(item, seg, seg.start);
      return;
    }
    if (b.dataset.action === 'syncTimingAll') {
      const tIn = Math.max(0.1, Number(seg.timingIn) || 0.75);
      const tMid = Math.max(0, Number(seg.timingMid ?? 1.5));
      const tOut = Math.max(0.1, Number(seg.timingOut) || 0.75);
      for (const itemSeg of data.lyrics) {
        itemSeg.timingIn = tIn;
        itemSeg.timingMid = tMid;
        itemSeg.timingOut = tOut;
      }
      persist();
      draw(time());
      toast(`Đã áp dụng Timing (${tIn.toFixed(2)}× · ${tMid.toFixed(2)}× · ${tOut.toFixed(2)}×) cho tất cả ${data.lyrics.length} đoạn.`);
    }
  });

  // 2026-11-07: Khách hàng muốn kéo trực tiếp trên thanh thời gian của từng câu lời để chỉnh thời điểm Bắt đầu / Kết thúc hoặc tua nghe thử ngay tại đó; xử lý pointerdown trên .seg-track để kéo mượt 2 đầu mốc start/end hoặc tua con chạy phát nhạc.
  $('lyricList').addEventListener('pointerdown', (e) => {
    const track = e.target.closest('[data-role="segTrack"]');
    if (!track) return;
    const item = track.closest('.lyric-item');
    if (!item) return;
    const seg = data.lyrics.find((x) => String(x.id) === item.dataset.id);
    if (!seg) return;

    e.preventDefault();
    const boxEl = track.closest('.seg-timeline-box');
    const areaEl = track.closest('.seg-track-area');
    if (areaEl) areaEl.focus({ preventScroll: true });
    if (boxEl) boxEl.classList.add('is-dragging');
    const handleEl = e.target.closest('[data-handle]');
    const mode = handleEl ? handleEl.dataset.handle : 'scrub';
    const { winMin, winMax } = getSegmentWindow(item, seg);
    item._dragWinMin = winMin;
    item._dragWinMax = winMax;

    const updateFromClientX = (clientX) => {
      const rect = track.getBoundingClientRect();
      const ratio = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const val = winMin + ratio * (winMax - winMin);

      if (mode === 'start') {
        seg.start = clamp(val, 0, Math.max(0, seg.end - 0.35));
        item.querySelector('[data-field="start"]').value = secText(seg.start);
        item.querySelector('.lyric-status').textContent = `${secText(seg.start)} – ${secText(seg.end)}`;
        setTime(seg.start);
        syncSegmentTrackUI(item, seg, seg.start);
        renderScrubberSegments();
      } else if (mode === 'end') {
        seg.end = Math.max(seg.start + 0.35, val);
        item.querySelector('[data-field="end"]').value = secText(seg.end);
        item.querySelector('.lyric-status').textContent = `${secText(seg.start)} – ${secText(seg.end)}`;
        setTime(Math.max(seg.start, seg.end - 0.6));
        syncSegmentTrackUI(item, seg, time());
        renderScrubberSegments();
      } else {
        previewSegId = null;
        previewSegEnd = null;
        setTime(val);
        syncSegmentTrackUI(item, seg, val);
      }
    };

    updateFromClientX(e.clientX);

    const onMove = (ev) => updateFromClientX(ev.clientX);
    const onUp = () => {
      delete item._dragWinMin;
      delete item._dragWinMax;
      if (boxEl) boxEl.classList.remove('is-dragging');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      syncSegmentTrackUI(item, seg, time());
      syncSortedOrderAndBadge(item, seg);
      persist();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });

  // 2026-11-07: Khách hàng cần chèn câu lời mới vào vị trí bất kỳ (Trước câu 1, Giữa câu 1 và 2 / Sau câu đang chọn, hoặc Cuối danh sách) với nguyên tắc giữ nguyên toàn bộ thời gian & nội dung các câu cũ và tự động sắp xếp thứ tự trước-sau; trước đó chỉ có nút thêm vào cuối làm không thể chèn vào đầu hoặc giữa dàn câu có sẵn, nay bổ sung insertLyricSegment('before' | 'after' | 'end') tính mốc thời gian hợp lý và splice đúng vị trí để đẩy các câu phía sau lên (ví dụ chèn trước #1 thì câu mới là #1, câu #1 cũ đẩy thành #2).
  function insertLyricSegment(positionMode = 'end') {
    const sorted = sortedLyrics();
    const curIdx = sorted.findIndex((s) => String(s.id) === String(selectedSegId));
    const activeIdx = curIdx >= 0 ? curIdx : 0;
    const curSeg = sorted[activeIdx] || null;

    let start = 0;
    let end = 4;
    let insertIdx = sorted.length;

    if (!sorted.length || positionMode === 'end') {
      const last = Math.max(0, ...sorted.map((x) => x.end));
      start = Math.max(time(), last + 0.15);
      end = start + 4;
      insertIdx = sorted.length;
    } else if (positionMode === 'before') {
      insertIdx = activeIdx;
      const prevSeg = activeIdx > 0 ? sorted[activeIdx - 1] : null;
      if (!prevSeg) {
        // Chèn vào trước câu #1 -> câu mới trở thành #1, đẩy câu #1 cũ thành #2
        if (curSeg.start >= 0.45) {
          start = Math.max(0, Number((curSeg.start - 4).toFixed(2)));
          end = Number(Math.max(start + 0.35, curSeg.start - 0.05).toFixed(2));
        } else {
          start = 0;
          end = Number(Math.max(0.5, Math.min(2.5, curSeg.end)).toFixed(2));
        }
      } else {
        // Chèn vào giữa prevSeg và curSeg
        if (curSeg.start - prevSeg.end >= 0.4) {
          start = Number((prevSeg.end + 0.02).toFixed(2));
          end = Number((curSeg.start - 0.02).toFixed(2));
        } else if (curSeg.start > prevSeg.start) {
          start = Number(Math.min(prevSeg.end, (prevSeg.start + curSeg.start) / 2).toFixed(2));
          end = Number(Math.max(start + 0.5, Math.min(start + 3, curSeg.end)).toFixed(2));
        } else {
          start = curSeg.start;
          end = Number((start + 2.5).toFixed(2));
        }
      }
    } else if (positionMode === 'after') {
      insertIdx = activeIdx + 1;
      const nextSeg = activeIdx + 1 < sorted.length ? sorted[activeIdx + 1] : null;
      if (!nextSeg) {
        start = Number((curSeg.end + 0.15).toFixed(2));
        end = Number((start + 4).toFixed(2));
      } else if (nextSeg.start - curSeg.end >= 0.4) {
        start = Number((curSeg.end + 0.02).toFixed(2));
        end = Number((nextSeg.start - 0.02).toFixed(2));
      } else if (nextSeg.start > curSeg.start) {
        start = Number(Math.min(curSeg.end, nextSeg.start).toFixed(2));
        end = Number(Math.max(start + 0.5, Math.min(start + 3, nextSeg.end)).toFixed(2));
      } else {
        start = curSeg.start;
        end = Number((start + 2.5).toFixed(2));
      }
    }

    const seg = {
      id: Date.now() + Math.random(),
      start,
      end,
      text: '',
      mode: curSeg ? curSeg.mode : 'queue',
      timingIn: curSeg ? Number(curSeg.timingIn) || 0.75 : 0.75,
      timingMid: curSeg ? Number(curSeg.timingMid ?? 1.5) : 1.5,
      timingOut: curSeg ? Number(curSeg.timingOut) || 0.75 : 0.75
    };

    sorted.splice(insertIdx, 0, seg);
    data.lyrics = sorted;
    data.lyrics = sortedLyrics();
    selectedSegId = String(seg.id);
    activeId = null;
    buildList();
    persist();

    const finalSorted = sortedLyrics();
    const newPos = finalSorted.findIndex((x) => String(x.id) === String(seg.id)) + 1;
    const node = [...document.querySelectorAll('.lyric-item')].find((e) => e.dataset.id === String(seg.id));
    if (node) {
      node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      node.querySelector('textarea').focus();
    }
    updateTransport(time());
    if (positionMode === 'before') {
      toast(`Đã chèn câu mới vào vị trí #${newPos} (các câu phía sau tự động đẩy lên).`);
    } else if (positionMode === 'after') {
      toast(`Đã chèn câu mới vào vị trí #${newPos} (giữ nguyên các câu cũ).`);
    }
  }

  if ($('insertBeforeBtn')) {
    $('insertBeforeBtn').addEventListener('click', () => insertLyricSegment('before'));
  }
  if ($('insertAfterBtn')) {
    $('insertAfterBtn').addEventListener('click', () => insertLyricSegment('after'));
  }
  $('addLyricBtn').addEventListener('click', () => insertLyricSegment('end'));

  $('resetDemoBtn').addEventListener('click', () => {
    if (!confirm('Khôi phục 3 đoạn lời mẫu? Các đoạn hiện tại sẽ bị thay thế.')) return;
    data.lyrics = structuredClone(DEFAULT_LYRICS);
    selectedSegId = String(data.lyrics[0].id);
    activeId = null;
    buildList();
    persist();
    toast('Đã khôi phục lời mẫu.');
  });

  $('importLrcBtn').addEventListener('click', () => $('lyricsDialog').showModal());
  $('cancelLrcBtn').addEventListener('click', () => $('lyricsDialog').close());
  $('confirmLrcBtn').addEventListener('click', () => {
    const s = $('lrcText').value.trim();
    if (!s) {
      toast('Hãy nhập ít nhất một dòng lời hát.');
      return;
    }
    const rows = s.split(/\r?\n/).filter((x) => x.trim());
    const parsed = [];
    for (const row of rows) {
      const m = row.match(/^\[(\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\]\s*(.*)$/);
      if (m) parsed.push({ start: parseTime(m[1]), text: m[2] || '♪' });
      else if (!row.match(/^\[(ar|ti|al|by|offset):/i)) parsed.push({ start: NaN, text: row.trim() });
    }
    if (!parsed.length) {
      toast('Không tìm thấy lời bài hát hợp lệ.');
      return;
    }
    const hasTimes = parsed.some((r) => Number.isFinite(r.start));
    let current = 0;
    for (const p of parsed) {
      if (!Number.isFinite(p.start)) p.start = current;
      current = p.start + 4;
    }
    parsed.sort((a, b) => a.start - b.start);
    data.lyrics = parsed.map((p, i) => ({
      id: Date.now() + i,
      start: p.start,
      end: i + 1 < parsed.length ? Math.max(p.start + 0.35, parsed[i + 1].start - 0.08) : p.start + 4,
      text: p.text,
      mode: 'queue',
      timingIn: 0.75,
      timingMid: 1.5,
      timingOut: 0.75
    }));
    selectedSegId = String(data.lyrics[0].id);
    activeId = null;
    buildList();
    persist();
    updateTransport(time());
    $('lyricsDialog').close();
    toast(`Đã nhập ${parsed.length} đoạn lời ${hasTimes ? 'theo mốc LRC' : 'mỗi đoạn 4 giây'}.`);
  });

  const download = (blob, name) => {
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };

  function syncBeatControls() {
    const effect=data.beatEffect;
    if($('beatEnabled')) { $('beatEnabled').checked=Boolean(effect?.enabled); $('beatEnabled').disabled=!effect?.beats?.length; }
    if($('beatAmount')) { $('beatAmount').value=Math.round((effect?.amount ?? .8)*100); $('beatAmount').disabled=!effect; }
    if($('beatAmountVal')) $('beatAmountVal').textContent=Math.round((effect?.amount ?? .8)*100)+'%';
    if($('beatBpm')) $('beatBpm').textContent=effect?.bpm ? Math.round(effect.bpm)+' BPM' : 'Chưa phân tích nhạc';
    if($('introEnabled')) $('introEnabled').checked=Boolean(data.intro?.enabled);
  }
  $('beatEnabled')?.addEventListener('change',e=>{if(data.beatEffect){data.beatEffect.enabled=e.target.checked;persist();draw(time());}});
  $('beatAmount')?.addEventListener('input',e=>{if(data.beatEffect){data.beatEffect.amount=Number(e.target.value)/100;syncBeatControls();persist();draw(time());}});
  $('introEnabled')?.addEventListener('change',e=>{
    data.intro={title:data.songTitle||$('musicTitle').textContent,subtitle:data.artist||'',end:(sortedLyrics()[0]?.start||30)-1.2,...data.intro,enabled:e.target.checked};
    persist();draw(time());
  });

  async function applySunsetPreset() {
    try {
      const response = await fetch('assets/sunset-deep-plum-v2.png');
      if (!response.ok) throw new Error('background unavailable');
      useImage(await response.blob(), {name:'Hoàng hôn tím hồng', silent:true});
      Object.assign(data, {weather:'none', density:8, dim:0, font:data.font, fontSize:76,
        glow:24, textColor:'#fff5fa', accentColor:'#f2a6d5', position:'center'});
      data.lyrics.forEach(seg => { seg.mode='soft'; seg.timingIn=0.45; seg.timingMid=2.2; seg.timingOut=0.45; });
      applyData(); persist();
      toast('Đã áp dụng nền hoàng hôn và chuyển động mềm.');
    } catch (error) { toast('Chưa tải được nền hoàng hôn. Hãy thử lại.'); }
  }

  function splitShortLyrics() {
    data.lyrics = sortedLyrics().flatMap(seg => NebulaMotion.splitSegment(seg));
    selectedSegId = data.lyrics.length ? String(data.lyrics[0].id) : null;
    activeId = null; applyData(); persist();
    toast(`Đã tách theo dấu câu và xuống dòng: ${data.lyrics.length} cụm lời, tự vừa một dòng.`);
  }

  // 2026-11-15: Khách hàng dùng tính năng mở dự án / khôi phục workspace có chứa sticker và GIF hoạt họa (như đoạn nhạc dạo); trước đó loadProjectMedia chỉ nạp nhạc và ảnh nền mà bỏ qua obj.media.stickers khiến animation không hiển thị, nên sửa để tải thêm danh sách sticker/GIF từ project JSON và đồng bộ vào bộ nhớ.
  async function loadProjectMedia(obj) {
    const media = obj.media || {};
    const localAsset = value => {
      if (!value) return null;
      const url = new URL(value, location.href);
      return url.origin === location.origin ? url.href : null;
    };
    const bgUrl = localAsset(media.background || obj.backgroundUrl);
    const audioUrl = localAsset(media.audio || obj.audioUrl);
    if (bgUrl) {
      const result = await fetch(bgUrl);
      if (!result.ok) throw new Error('missing background');
      useImage(await result.blob(), {name: media.backgroundName || obj.backgroundFile || 'Hồ Hoàng Hôn Dưới Ánh Trăng Sao', silent:true});
    }
    if (audioUrl) {
      const result = await fetch(audioUrl);
      if (!result.ok) throw new Error('missing audio');
      currentYtId = extractYoutubeId(obj._ytUrl || obj.youtubeUrl || obj.youtubeId || '');
      if ($('ytUrlInput')) $('ytUrlInput').value = obj._ytUrl || obj.youtubeUrl || '';
      await loadAudioBlob(await result.blob(), obj.songTitle || 'Nhạc remix', obj.artist || 'YouTube');
      if (currentYtId) {
        $('ytThumbImg').src = `https://i.ytimg.com/vi/${currentYtId}/hqdefault.jpg`;
        $('ytTrackTitle').textContent = obj.songTitle || 'Nhạc remix';
        $('ytTrackAuthor').textContent = obj.artist || 'YouTube';
        $('ytPreviewCard').classList.remove('hidden');
      }
    }
    const rawStickers = Array.isArray(media.stickers) ? media.stickers : (Array.isArray(obj.stickers) ? obj.stickers : null);
    if (rawStickers) {
      stickers = stickers.filter(s => s && s.type === 'text');
      for (const st of rawStickers) {
        if (!st) continue;
        const assetUrl = localAsset(st.url || st.src);
        if (assetUrl) {
          try {
            const res = await fetch(assetUrl);
            if (res.ok) {
              const blob = await res.blob();
              await addStickerFiles([{ ...st, blob }], { skipSave: true });
            }
          } catch (e) {}
        }
      }
      buildStickerList();
      persistStickers();
    }
  }
  $('sunsetPresetBtn')?.addEventListener('click', applySunsetPreset);
  $('splitLyricsBtn')?.addEventListener('click', splitShortLyrics);

  $('saveProjectBtn').addEventListener('click', () =>
    download(
      new Blob(
        [
          JSON.stringify(
            {
              ...data,
              version: 3,
              textOverlays: projectTextOverlays(),
              note: 'Media files are stored locally; re-upload or paste YouTube link when opening this project.'
            },
            null,
            2
          )
        ],
        { type: 'application/json' }
      ),
      'nebula-lyric-project.json'
    )
  );

  async function loadQuickExportProject(jsonPath, label) {
    try {
      pause();
      const res = await fetch(jsonPath);
      if (!res.ok) throw new Error('missing export json');
      const obj = await res.json();
      await applyProjectObject(obj);
      setTime(0);
      toast(`Đã chuyển sang: ${label}`);
    } catch (err) {
      toast(`Không thể mở ${label}`);
    }
  }
  $('quickSong1Btn')?.addEventListener('click', () => loadQuickExportProject('/exports/sao-minh-chua-nam-tay-nhau.json', 'Bài 1: Sao Mình Chưa Nắm Tay Nhau'));
  $('quickSong2Btn')?.addEventListener('click', () => loadQuickExportProject('/exports/den-khi-nao.json', 'Bài 2: Đến Khi Nào'));
  $('quickSong3Btn')?.addEventListener('click', () => loadQuickExportProject('/exports/di-ve-nha.json', 'Bài 3: Đi Về Nhà (Cha Cha Cha)'));
  $('quickMedleyBtn')?.addEventListener('click', () => loadQuickExportProject('/exports/lien-khuc-2-bai.json', 'Liên Khúc 2 Bài Nối Tiếp'));

  $('loadProjectBtn').addEventListener('click', () => $('projectInput').click());
  async function applyProjectObject(obj) {
      if (!obj || !Array.isArray(obj.lyrics)) throw Error('bad json');
      const importedFont = ['oswald', 'vietnam', 'elegant', 'modern', 'poetic'].includes(obj.font)
        ? obj.font
        : 'oswald';
      const importedWeather = VALID_WEATHERS.includes(obj.weather) ? obj.weather : 'galaxy';
      const importedMode = VALID_MODES.includes(obj.lyricMode)
        ? obj.lyricMode
        : VALID_MODES.includes(obj.lyrics?.[0]?.mode)
        ? obj.lyrics[0].mode
        : 'queue';
      const fallbackIn = Math.max(0.1, Number(obj.timingIn) || 0.75);
      const fallbackMid = Math.max(0, Number(obj.timingMid ?? 1.5));
      const fallbackOut = Math.max(0.1, Number(obj.timingOut) || 0.75);
      data = {
        ...structuredClone(DEFAULT),
        ...obj,
        weather: importedWeather,
        font: importedFont,
        lyricMode: importedMode,
        fontSize: Number(obj.fontSize) || 76,
        beatEffect: normalizeBeatEffect(obj.beatEffect || obj.rhythmEffect || obj.rhythm || obj.beatTrack),
        lyrics: obj.lyrics.map((p, i) => ({
          id: p.id || i + Date.now(),
          start: Number(p.start) || 0,
          end: Number(p.end) || 4,
          text: String(p.text || ''),
          icon: String(p.icon || ''),
          words: Array.isArray(p.words) ? p.words : undefined,
          mode: VALID_MODES.includes(p.mode) ? p.mode : importedMode,
          timingIn: Math.max(0.1, Number(p.timingIn) || fallbackIn),
          timingMid: Math.max(0, Number(p.timingMid ?? fallbackMid)),
          timingOut: Math.max(0.1, Number(p.timingOut) || fallbackOut)
        }))
      };
      await loadProjectMedia(obj);
      importTextOverlays(obj.textOverlays);
      selectedSegId = data.lyrics.length ? String(data.lyrics[0].id) : null;
      activeId = null;
      applyData();
      persist();
      toast('Đã mở dự án thành công.');
  }

  $('projectInput').addEventListener('change', async (e) => {
    const file=e.target.files[0];
    if(!file)return;
    try { await applyProjectObject(JSON.parse(await file.text())); }
    catch(error) { toast('Không mở được dự án. Kiểm tra tệp JSON và các tệp media.'); }
    e.target.value='';
  });

  async function openRequestedProject() {
    const current=new URL(location.href);
    const requested=current.searchParams.get('project');
    if(!requested)return;
    try {
      const target=new URL(requested,location.origin+'/');
      if(target.origin!==location.origin || !target.pathname.startsWith('/exports/') || !target.pathname.endsWith('.json')) throw Error('invalid project path');
      const response=await fetch(target.href);
      if(!response.ok)throw Error('project unavailable');
      await applyProjectObject(await response.json());
      current.searchParams.delete('project');
      history.replaceState(null,'',current.pathname+current.search+current.hash);
    } catch(error) {
      toast('Không mở được dự án từ liên kết. Bạn có thể dùng nút Mở dự án.');
    }
  }

  // Drag-drop media over canvas.
  const canvasWrapper = document.querySelector('.preview-outer');
  canvasWrapper.addEventListener('dragover', (e) => {
    e.preventDefault();
    canvasWrapper.style.outline = '2px dashed #38bdf8';
  });
  canvasWrapper.addEventListener('dragleave', () => (canvasWrapper.style.outline = ''));
  canvasWrapper.addEventListener('drop', (e) => {
    e.preventDefault();
    canvasWrapper.style.outline = '';
    for (const f of e.dataTransfer.files) {
      if (f.type.startsWith('image/')) useImage(f);
      else if (f.type.startsWith('audio/')) useAudio(f);
    }
  });

  async function ensureAudioRouting() {
    ensureAudioContextSync();
    if (!audioSource && audioReady) {
      try {
        audioSource = audioContext.createMediaElementSource(audio);
        audioSource.connect(audioContext.destination);
        audioSource.connect(audioDestination);
      } catch (e) {}
    }
    await audioContext.resume();
  }

  async function startRecord() {
    if (!pcmReady && !audioReady) {
      toast('Hãy tải file nhạc hoặc dán link YouTube trước khi xuất video.');
      return;
    }
    if (!window.MediaRecorder || !canvas.captureStream) {
      toast('Trình duyệt chưa hỗ trợ xuất video.');
      return;
    }
    if (data.lyrics.length === 0) {
      toast('Hãy nhập lời bài hát trước.');
      return;
    }
    try {
      pause();
      await ensureAudioRouting();
      const mime = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=h264,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm'
      ].find((x) => MediaRecorder.isTypeSupported(x));
      if (!mime) {
        toast('Hệ thống chưa hỗ trợ ghi WebM.');
        return;
      }
      isExporting = true;
      clearTimeout(previewResizeTimer);
      sizePreviewCanvas(true);
      setTime(0);
      draw(0);
      const videoCanvasStream = canvas.captureStream(30);
      const vTrack = videoCanvasStream.getVideoTracks()[0];
      if (vTrack && 'contentHint' in vTrack) {
        try { vTrack.contentHint = 'detail'; } catch (e) {}
      }
      exportStream = new MediaStream([
        ...videoCanvasStream.getVideoTracks(),
        ...audioDestination.stream.getAudioTracks()
      ]);
      recordingChunks = [];
      exportRecorder = new MediaRecorder(exportStream, {
        mimeType: mime,
        videoBitsPerSecond: 12000000,
        audioBitsPerSecond: 256000
      });
      exportRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size) recordingChunks.push(e.data);
      };
      exportRecorder.onstop = () => {
        isExporting = false;
        stopExportBackgroundTicker();
        const chunks = recordingChunks;
        recordingChunks = [];
        if (chunks.length) download(new Blob(chunks, { type: mime }), 'nebula-lyric-video-1080p.webm');
        if (exportStream)
          exportStream
            .getTracks()
            .filter((t) => t.kind === 'video')
            .forEach((t) => t.stop());
        exportStream = null;
        exportRecorder = null;
        sizePreviewCanvas();
        $('exportBtn').classList.remove('recording');
        $('exportBtn').innerHTML =
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg><span>Xuất video WebM</span>';
        $('previewStatus').textContent = 'LIVE PREVIEW';
        toast('Đã lưu video WebM 1080p Full HD thành công!');
      };
      exportRecorder.onerror = () => {
        isExporting = false;
        stopExportBackgroundTicker();
        toast('Có lỗi trong lúc ghi video.');
      };
      startExportBackgroundTicker();
      exportRecorder.start(1000);
      $('exportBtn').classList.add('recording');
      $('exportBtn').textContent = '■ Dừng & lưu video';
      $('previewStatus').textContent = '● ĐANG GHI 1080P';
      if (pcmReady && pcmBuffer) {
        startPcmSourceAt(0);
        playing = true;
      } else {
        await audio.play();
        playing = true;
      }
      setPlayingUI();
      toast('Đang ghi video Full HD 1080p (1920×1080 · 30fps). Chờ nhạc hết hoặc bấm Dừng & lưu.');
    } catch (err) {
      isExporting = false;
      console.error(err);
      if (exportRecorder && exportRecorder.state === 'recording') exportRecorder.stop();
      toast('Không thể xuất video.');
    }
  }

  function stopRecord() {
    if (!recording()) return;
    pause();
    try {
      exportRecorder.stop();
    } catch (e) {}
  }

  $('exportBtn').addEventListener('click', () => (recording() ? stopRecord() : startRecord()));
  // 2026-11-15: Khách hàng cần khi tải lại trang (F5) sẽ hiển thị ngay dữ liệu chuẩn mới nhất từ workspace_state.json; trước đó beforeunload gọi persist() ghi đè dữ liệu cũ trong RAM lên localStorage với _updatedAt=Date.now() khiến bản cập nhật trên đĩa bị bỏ qua, nên không gọi persist() khi unload và luôn ưu tiên nạp từ /api/workspace.
  window.addEventListener('beforeunload', (e) => {
    if (recording()) {
      e.preventDefault();
      e.returnValue = 'Video đang ghi chưa lưu.';
    }
  });

  // 2026-11-15: Khách hàng mong muốn khi tạo hoặc cập nhật dự án vào workspace_state.json thì mở/F5 ứng dụng lên sẽ hiển thị ngay dự án chuẩn mới nhất; luôn ưu tiên nạp bản từ /api/workspace và đồng bộ xuống localStorage.
  async function restoreWorkspaceFromCache() {
    try {
      const savedLocal = JSON.parse(localStorage.getItem(KEY) || 'null');
      let diskObj = null;
      try {
        const res = await fetch(`${LOCAL_API_BASE}/api/workspace`);
        if (res.ok) {
          const parsed = await res.json();
          if (parsed && Array.isArray(parsed.lyrics) && parsed.lyrics.length > 0) diskObj = parsed;
        }
      } catch (e) {}
      if (diskObj) {
        localStorage.setItem(KEY, JSON.stringify(diskObj));
        await applyProjectObject(diskObj);
        return;
      }
      const stateObj = savedLocal || diskObj;
      if (stateObj) {
        if (stateObj._selectedSegId) selectedSegId = String(stateObj._selectedSegId);
        if (stateObj._selectedStickerId) selectedStickerId = String(stateObj._selectedStickerId);
        if (stateObj._ytUrl && $('ytUrlInput')) $('ytUrlInput').value = stateObj._ytUrl;
      }

      const [savedAudio, savedBg, savedStickers] = await Promise.all([
        idbGet('active_audio'),
        idbGet('active_bg'),
        idbGet('active_stickers')
      ]);

      if (savedBg && savedBg.blob) {
        useImage(savedBg.blob, { name: savedBg.name, skipSave: true, silent: true });
      }
      if (Array.isArray(savedStickers) && savedStickers.length) {
        await addStickerFiles(savedStickers, { skipSave: true });
      }
      if (savedAudio && savedAudio.blob) {
        if (audioGeneration > 0) return;
        currentYtId = savedAudio.ytId || null;
        if (currentYtId && $('ytPreviewCard')) {
          $('ytThumbImg').src = `https://i.ytimg.com/vi/${currentYtId}/hqdefault.jpg`;
          $('ytTrackTitle').textContent = (savedAudio.displayTitle || '').replace(/\.[^.]+$/, '');
          $('ytTrackAuthor').textContent = `${savedAudio.subLabel || 'YouTube'} · Khôi phục từ phiên trước`;
          $('ytPreviewCard').classList.remove('hidden');
        }
        await loadAudioBlob(savedAudio.blob, savedAudio.displayTitle || 'audio.m4a', savedAudio.subLabel, {
          skipSave: true
        });
      }
    } catch (e) {}
  }

  // Check local YouTube audio bridge status
  fetch(`${LOCAL_API_BASE}/api/health`)
    .then((r) => r.ok && r.json())
    .then((d) => {
      if (d && d.ok) {
        $('engineDot')?.classList.add('online');
        if ($('engineText')) $('engineText').textContent = 'Studio Engine · Tự lưu tiến trình';
      }
    })
    .catch(() => {
      if ($('engineText')) $('engineText').textContent = 'Chế độ trình duyệt';
    });

  data.beatEffect = normalizeBeatEffect(data.beatEffect);
  applyData();
  setPlayingUI();
  updateTransport(time());
  restoreWorkspaceFromCache().then(openRequestedProject).finally(() => { historyCurrent = historySnapshot(); historyReady = true; updateHistoryButtons(); });
  sizePreviewCanvas();
  requestAnimationFrame(loop);

  // Load web fonts without blocking the offline-capable editor, and force-load Vietnamese subsets before caching intro/lyric canvases.
  const refreshWebFonts = () => {
    clearAllTextArtworks();
    draw(time());
  };
  const webFont = document.createElement('link');
  webFont.rel = 'stylesheet';
  webFont.href =
    'https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;600;700;800&family=Lora:ital,wght@0,400;0,500;1,500&family=Oswald:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,600;0,700;1,600&display=swap';
  webFont.onload = () => document.fonts.ready.then(refreshWebFonts);
  if (document.fonts) {
    document.fonts.addEventListener('loadingdone', refreshWebFonts);
    if (typeof document.fonts.load === 'function') {
      Promise.all([
        document.fonts.load('700 86px "Oswald"', 'ĐẾN KHI NÀO SAO MÌNH CHƯA NẮM TAY NHAU ĂÂĐÊÔƠƯẤẾỐỚỨỲỶỸỴ'),
        document.fonts.load('600 26px "Oswald"', 'ĐẾN KHI NÀO SAO MÌNH CHƯA NẮM TAY NHAU ĂÂĐÊÔƠƯẤẾỐỚỨỲỶỸỴ'),
        document.fonts.load('700 84px "Be Vietnam Pro"', 'ĐẾN KHI NÀO SAO MÌNH CHƯA NẮM TAY NHAU ĂÂĐÊÔƠƯẤẾỐỚỨỲỶỸỴ')
      ]).then(refreshWebFonts).catch(() => {});
    }
    if (document.fonts.ready) document.fonts.ready.then(refreshWebFonts);
  }
  document.head.appendChild(webFont);
})();
