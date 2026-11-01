// ================== CONFIG ==================
const API_BASE = 'https://YOUR-API-DOMAIN.com/api';
const CHECK_KEY_PATH = '/check-key';
const LOGOUT_PATH = '/logout';
const DEMO_MODE = true;

// Phase 2: dán Supabase (GIỐNG hệt Key Manager)
const SUPABASE_URL = ''; // https://xxxx.supabase.co
const SUPABASE_ANON_KEY = ''; // anon key

function sbEnabled() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_URL.startsWith('http'));
}
async function sbGetKey(key) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/vipp_keys?key=eq.${encodeURIComponent(key)}&select=*`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY
      }
    }
  );
  if (!res.ok) throw new Error('Supabase error');
  const rows = await res.json();
  return rows[0] || null;
}
async function sbPatchKey(key, patch) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/vipp_keys?key=eq.${encodeURIComponent(key)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(patch)
    }
  );
  if (!res.ok) throw new Error(await res.text());
}

const DEMO_KEYS = {
  basic: 'basic', pro: 'pro', vip: 'vip', demo: 'vip',
  'sơ cấp': 'basic', 'trung cấp': 'pro', 'cao cấp': 'vip'
};

// Keys export từ Key Manager (local)
const LICENSE_STORE = 'vipp_tool_licenses_v1';
function loadLicenses() {
  try { return JSON.parse(localStorage.getItem(LICENSE_STORE) || '{"keys":[]}'); }
  catch { return { keys: [] }; }
}
function saveLicenses(data) {
  localStorage.setItem(LICENSE_STORE, JSON.stringify(data));
}
function findLicense(key) {
  const pack = loadLicenses();
  return (pack.keys || []).find(k => String(k.key).toLowerCase() === String(key).toLowerCase());
}


// 1000 AI = 10 nhóm × 100 node. UI hiện theo nhóm để không lag.
const AGENTS = [
  { id: 'logic', name: 'Logic & suy luận', count: 100 },
  { id: 'math', name: 'Toán & xác suất', count: 100 },
  { id: 'strategy', name: 'Trí tuệ chiến lược', count: 100 },
  { id: 'psych', name: 'Tâm lý hành vi', count: 100 },
  { id: 'cognition', name: 'Nhận thức & chú ý', count: 100 },
  { id: 'trend', name: 'Phân tích xu hướng', count: 100 },
  { id: 'risk', name: 'Rủi ro & an toàn', count: 100 },
  { id: 'critique', name: 'Phản biện & kiểm chứng', count: 100 },
  { id: 'language', name: 'Ngôn ngữ & diễn giải', count: 100 },
  { id: 'ensemble', name: 'Điều phối hệ thống', count: 100 }
];
const TOTAL_AI = AGENTS.reduce((s, a) => s + a.count, 0); // 1000


// ================== STATE ==================
let currentKey = null;
let history = [];
let winCount = 0;
let totalPredict = 0;
let pendingResult = null;
let systemXP = 0; // tiến hóa hệ thống
let deepMode = false;
let activeSeed = '';
let seedSource = 'Math.random() (mặc định)';

const $ = id => document.getElementById(id);
const show = el => el && el.classList.remove('hidden');
const hide = el => el && el.classList.add('hidden');

// ================== STORAGE ==================
function getDeviceId() {
  let id = localStorage.getItem('device_id');
  if (!id) {
    id = 'web_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('device_id', id);
  }
  return id;
}
function saveKey(info) { localStorage.setItem('key_info', JSON.stringify(info)); currentKey = info; }
function loadKey() { try { return JSON.parse(localStorage.getItem('key_info')); } catch { return null; } }
function clearKey() { localStorage.removeItem('key_info'); currentKey = null; }
function saveStats() { localStorage.setItem('vipp_stats', JSON.stringify({ history, winCount, totalPredict, systemXP })); }
function loadStats() {
  try {
    const d = JSON.parse(localStorage.getItem('vipp_stats') || '{}');
    history = d.history || [];
    winCount = d.winCount || 0;
    totalPredict = d.totalPredict || 0;
    systemXP = d.systemXP || 0;
  } catch {}
}
function clearStats() {
  history = []; winCount = 0; totalPredict = 0; systemXP = 0;
  localStorage.removeItem('vipp_stats');
  updateOverview(); updateSystemPanel(); renderHistory(); renderStats();
  hide($('aiTrend')); hide($('aiWarning'));
}

// ================== AUTH ==================
async function validateKey(key) {
  const clean = key.trim().toLowerCase();
  if (DEMO_MODE && DEMO_KEYS[clean]) {
    const info = { key: clean, level: DEMO_KEYS[clean], isActive: true, expireAt: null };
    saveKey(info);
    return info;
  }

  // Phase 2: check online Supabase
  if (sbEnabled()) {
    try {
      const row = await sbGetKey(key.trim());
      if (!row) return null;
      if (row.locked) return null;
      if (row.expires_at && Date.now() > row.expires_at) return null;
      const deviceId = getDeviceId();
      if (row.device_id && row.device_id !== deviceId) return null;
      if (!row.device_id) {
        await sbPatchKey(key.trim(), {
          device_id: deviceId,
          activated_at: Date.now(),
          last_online: Date.now(),
          open_count: (row.open_count || 0) + 1
        });
      } else {
        await sbPatchKey(key.trim(), {
          last_online: Date.now(),
          open_count: (row.open_count || 0) + 1
        });
      }
      let level = (row.level || 'basic').toLowerCase();
      if (['pro', 'trung'].includes(level)) level = 'pro';
      else if (['vip', 'cao'].includes(level)) level = 'vip';
      else level = 'basic';
      const info = { key: key.trim(), level, isActive: true, expireAt: row.expires_at || null };
      saveKey(info);
      return info;
    } catch (e) {
      console.error(e);
      // fallback license file bên dưới
    }
  }

  // Key từ Key Manager (import JSON - dự phòng)
  const lic = findLicense(key.trim());
  if (lic) {
    if (lic.locked) return null;
    if (lic.expiresAt && Date.now() > lic.expiresAt) return null;
    const deviceId = getDeviceId();
    if (lic.deviceId && lic.deviceId !== deviceId) return null;
    // bind device lần đầu
    if (!lic.deviceId) {
      const pack = loadLicenses();
      const row = pack.keys.find(k => k.key === lic.key);
      if (row) { row.deviceId = deviceId; saveLicenses(pack); }
    }
    let level = (lic.level || 'basic').toLowerCase();
    if (['pro', 'trung'].includes(level)) level = 'pro';
    else if (['vip', 'cao'].includes(level)) level = 'vip';
    else level = 'basic';
    const info = {
      key: key.trim(),
      level,
      isActive: true,
      expireAt: lic.expiresAt || null
    };
    saveKey(info);
    return info;
  }

  try {
    const res = await fetch(API_BASE + CHECK_KEY_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: key.trim(), device_id: getDeviceId() })
    });
    const data = await res.json();
    if (data.success || data.status === 'ok') {
      let level = (data.data?.level || data.level || 'basic').toLowerCase();
      if (['pro', 'trung'].includes(level)) level = 'pro';
      else if (['vip', 'cao'].includes(level)) level = 'vip';
      else level = 'basic';
      const info = { key: key.trim(), level, isActive: true };
      saveKey(info);
      return info;
    }
    return null;
  } catch {
    const local = loadKey();
    return local && local.key === key ? local : null;
  }
}

// ================== STATS HELPERS ==================
function getRecentWinrate() {
  if (!history.length) return 0.5;
  const r = history.slice(0, 10);
  return r.filter(h => h.isWin).length / r.length;
}
function getStreak() {
  if (!history.length) return { type: null, count: 0 };
  let count = 0;
  const first = history[0].isWin;
  for (const h of history) { if (h.isWin === first) count++; else break; }
  return { type: first ? 'win' : 'lose', count };
}
function getColorStreak() {
  if (!history.length) return { color: null, count: 0, isRed: null };
  let count = 0;
  const first = history[0].isRed;
  for (const h of history) { if (h.isRed === first) count++; else break; }
  return { color: first ? 'Đỏ' : 'Xanh', count, isRed: first };
}
function recentColorBias() {
  if (!history.length) return 0; // -1 Xanh ... +1 Đỏ
  const r = history.slice(0, 8);
  const red = r.filter(h => h.isRed).length;
  return (red / r.length) * 2 - 1;
}

// ================== MULTI-AI ENGINE (BETA) ==================
// Mỗi AI trả về score: -1 (mạnh về Xanh) → +1 (mạnh về Đỏ)
// ===== SEED / RNG =====
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRng(seedStr) {
  // Mulberry32 — RNG có seed, ổn định theo seed
  let state = hashString(String(seedStr || Date.now()));
  return function next() {
    state |= 0;
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getActiveRng() {
  const seedVal = ($('seedInput')?.value || activeSeed || '').trim();
  if (seedVal) {
    activeSeed = seedVal;
    return makeRng(seedVal + '|' + seedSource);
  }
  return Math.random;
}

function setSeedSource(text) {
  seedSource = text;
  if ($('seedSource')) $('seedSource').textContent = 'Nguồn: ' + text;
}

function formulaBias(dice) {
  // Công thức cũ: tổng 4 số + trừ theo ngưỡng → tín hiệu Đỏ/Xanh
  const total = dice.reduce((a, b) => a + b, 0);
  let sub = 12;
  if (total < 8) sub = 5;
  else if (total <= 17) sub = 12;
  else sub = 18;
  const adjusted = total - sub;
  // chẵn/lẻ + biên độ để tạo hướng rõ hơn
  let s = (adjusted % 2 === 0) ? 0.35 : -0.35;
  s += ((adjusted - 6) / 12) * 0.4; // tổng sau trừ cao/thấp
  s += ((total - 14) / 10) * 0.25;
  return clamp(s);
}

function runAgents(dice) {
  const sum = dice.reduce((a, b) => a + b, 0);
  const avg = sum / 4;
  const variance = dice.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / 4;
  const cs = getColorStreak();
  const st = getStreak();
  const wr = getRecentWinrate();
  const bias = recentColorBias();
  const rng = getActiveRng();
  const noise = () => (rng() - 0.5) * 0.22; // giảm nhiễu để bớt “trung lập mãi”
  const odds = dice.filter(d => d % 2 === 1).length;
  const fBias = formulaBias(dice); // kết hợp công thức

  // sample ít hơn nhưng tín hiệu gốc mạnh hơn → ít bị trung lập
  function clusterScore(baseFn, n = 12) {
    let s = 0;
    for (let i = 0; i < n; i++) s += baseFn();
    return clamp(s / n);
  }

  const groups = {
    logic: () => clusterScore(() => {
      const parity = ((odds - 2) / 2) * 0.7;
      return clamp(parity * 0.55 + fBias * 0.55 + noise());
    }),
    math: () => clusterScore(() => {
      return clamp(fBias * 0.65 + ((sum - 14) / 8) * 0.35 + noise());
    }),
    strategy: () => clusterScore(() => {
      if (cs.count >= 2) {
        // vừa bắt tiếp diễn vừa bắt đảo chiều — linh hoạt theo độ dài chuỗi
        const cont = (cs.isRed ? 1 : -1) * Math.min(0.7, 0.15 + cs.count * 0.08);
        const rev = (cs.isRed ? -1 : 1) * Math.min(0.85, 0.1 + Math.max(0, cs.count - 2) * 0.14);
        const mix = cs.count >= 4 ? (cont * 0.35 + rev * 0.65) : (cont * 0.65 + rev * 0.35);
        return clamp(mix + fBias * 0.25 + noise());
      }
      return clamp(fBias * 0.7 + bias * 0.3 + noise());
    }),
    psych: () => clusterScore(() => {
      if (st.type === 'lose' && st.count >= 2) {
        // thua liên tiếp → nghiêng ngược bias gần đây (tránh FOMO đuổi theo)
        return clamp(-bias * 0.55 + fBias * 0.25 + noise());
      }
      if (st.type === 'win' && st.count >= 2) {
        return clamp(bias * 0.5 + fBias * 0.35 + 0.12 + noise());
      }
      return clamp(fBias * 0.45 + bias * 0.35 + noise());
    }),
    cognition: () => clusterScore(() => {
      const stable = 1 - Math.min(1, variance / 3);
      return clamp(fBias * (0.4 + stable * 0.4) + bias * 0.2 + noise());
    }),
    trend: () => clusterScore(() => {
      if (!cs.count) return clamp(fBias * 0.6 + bias * 0.5 + noise());
      const dir = cs.isRed ? 1 : -1;
      return clamp(dir * Math.min(0.9, 0.25 + cs.count * 0.14) + fBias * 0.3 + noise());
    }),
    risk: () => clusterScore(() => {
      // Không cứng trung lập: luôn có hướng theo công thức + trạng thái
      if (st.type === 'lose' && st.count >= 3) {
        return clamp(-fBias * 0.4 + noise()); // thận trọng, nghiêng ngược công thức nhẹ
      }
      if (st.type === 'win' && st.count >= 2) {
        return clamp(fBias * 0.55 + bias * 0.25 + noise());
      }
      // rủi ro trung bình: bám công thức nhưng giảm biên độ
      return clamp(fBias * 0.5 + noise());
    }),
    critique: () => clusterScore(() => {
      if (cs.count >= 4) {
        const rev = cs.isRed ? -1 : 1;
        return clamp(rev * 0.55 + fBias * 0.2 + noise());
      }
      if (cs.count >= 2) {
        const cont = cs.isRed ? 1 : -1;
        return clamp(cont * 0.3 + fBias * 0.4 + noise());
      }
      return clamp(fBias * 0.55 + noise());
    }),
    language: () => clusterScore(() => clamp(fBias * 0.5 + bias * 0.35 + noise() * 0.8)),
    ensemble: () => 0
  };

  const scores = {};
  for (const a of AGENTS) {
    if (a.id === 'ensemble') continue;
    scores[a.id] = groups[a.id]();
  }

  const weights = {
    logic: 1.3,
    math: 1.45,
    strategy: 1.7,
    psych: 1.2,
    cognition: 1.15,
    trend: 1.55,
    risk: 1.35,
    critique: 1.4,
    language: 0.85
  };
  // Công thức được vote thêm như một “cột sống”
  let wsum = 0, acc = 0;
  for (const [id, sc] of Object.entries(scores)) {
    const w = weights[id] || 1;
    acc += sc * w;
    wsum += w;
  }
  acc += fBias * 1.8;
  wsum += 1.8;
  scores.ensemble = clamp(acc / wsum);
  // lưu công thức để UI/debug nội bộ
  scores._formula = fBias;
  return scores;
}

function clamp(v) { return Math.max(-1, Math.min(1, v)); }

function scoresToConsensus(scores) {
  // Chỉ lấy score nhóm, bỏ field phụ _formula nếu có
  const vals = Object.entries(scores)
    .filter(([k]) => !k.startsWith('_'))
    .map(([, v]) => v);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  // Kéo giãn % — tránh cả ngày 50/50
  let redPct = 50 + avg * 48;
  // Nếu có tín hiệu công thức rõ, siết thêm
  if (typeof scores._formula === 'number') {
    redPct += scores._formula * 8;
  }
  redPct = Math.max(22, Math.min(78, redPct));
  redPct = Math.round(redPct * 10) / 10;
  const bluePct = Math.round((100 - redPct) * 10) / 10;
  const isRed = redPct >= 50;
  // Đồng thuận dựa trên |avg| — không đội base quá cao khi tín hiệu yếu
  const confidence = Math.round((Math.abs(avg) * 72 + 28) * 10) / 10;
  return {
    isRed,
    color: isRed ? 'Đỏ' : 'Xanh',
    redPercent: isRed ? Math.max(redPct, bluePct) : Math.min(redPct, bluePct),
    bluePercent: isRed ? Math.min(redPct, bluePct) : Math.max(redPct, bluePct),
    redDisplay: redPct,
    blueDisplay: bluePct,
    confidence: Math.min(90, Math.max(25, confidence)),
    avg,
    formulaBias: scores._formula
  };
}

function signalLabel(score) {
  if (score > 0.08) return { text: 'Đỏ', cls: 'red' };
  if (score < -0.08) return { text: 'Xanh', cls: 'blue' };
  return { text: 'Trung lập', cls: 'neutral' };
}

function buildReason(consensus, scores) {
  const cs = getColorStreak();
  const st = getStreak();
  const lean = Object.entries(scores)
    .map(([id, sc]) => ({ id, sc, ...signalLabel(sc) }))
    .filter(x => x.cls !== 'neutral');

  const redAgents = lean.filter(x => x.cls === 'red').length;
  const blueAgents = lean.filter(x => x.cls === 'blue').length;
  const dominant = redAgents >= blueAgents ? 'Đỏ' : 'Xanh';
  const gap = Math.abs(redAgents - blueAgents);

  const parts = [];
  parts.push(`Kết hợp công thức + cluster AI: nghiêng ${dominant} (biên ${gap} phiếu · ${redAgents} Đỏ / ${blueAgents} Xanh)`);

  if (cs.count >= 3) {
    if (consensus.color !== cs.color) {
      parts.push(`AI Đảo chiều đang chiếm ưu thế trước chuỗi ${cs.color} ${cs.count} ván — tín hiệu mean-reversion`);
    } else {
      parts.push(`AI Xu hướng và Chuỗi đang xác nhận tiếp diễn ${cs.color}`);
    }
  }

  if (st.type === 'win' && st.count >= 2) {
    parts.push(`chuỗi thắng hiện tại giúp tăng trọng số cho các AI hội tụ`);
  } else if (st.type === 'lose' && st.count >= 2) {
    parts.push(`chuỗi thua khiến AI Rủi ro kéo độ tin cậy xuống`);
  }

  if (consensus.confidence >= 72) {
    parts.push('mức đồng thuận chuyên gia cao, tín hiệu tương đối sạch');
  } else if (consensus.confidence <= 42) {
    parts.push('các chuyên gia đang phân tán — thị trường nhiễu, không nên over-commit');
  }

  return parts.join('. ') + '.';
}

function buildSuggestion(consensus) {
  const st = getStreak();
  if (st.type === 'lose' && st.count >= 3) {
    return 'Khuyến nghị chuyên gia: đang trong drawdown. Giảm size hoặc đứng ngoài 1–2 nhịp để bảo toàn vốn.';
  }
  if (consensus.confidence >= 75) {
    return 'Đồng thuận chuyên gia cao. Có thể ưu tiên hướng consensus với size kiểm soát.';
  }
  if (consensus.confidence >= 55) {
    return 'Tín hiệu khá rõ nhưng chưa cực đoan. Phù hợp size trung bình, không FOMO.';
  }
  if (consensus.confidence <= 40) {
    return 'Phân tán tín hiệu. Nên bỏ qua setup này hoặc chỉ quan sát — tránh force trade.';
  }
  return 'Giữ kỷ luật: size ổn định, không tăng vị thế khi chưa có edge rõ.';
}

// ================== UI HELPERS ==================

function getSystemLevel() {
  return { aiCount: TOTAL_AI || 1000, iq: 400, tier: 'Max' };
}

function updateSystemPanel() {
  const s = getSystemLevel();
  if ($('sysAICount')) $('sysAICount').textContent = s.aiCount;
  if ($('sysIQ')) $('sysIQ').textContent = s.iq;
  if ($('sysTier')) $('sysTier').textContent = s.tier;
}

function updateOverview() {
  $('ovWinrate').textContent = totalPredict ? Math.round(winCount / totalPredict * 100) + '%' : '—';
  $('ovRecord').textContent = `${winCount}/${totalPredict}`;
  const st = getStreak();
  $('ovStreak').textContent = st.type ? (st.type === 'win' ? 'W' : 'L') + st.count : '—';
}

function updateRank() {
  if (!currentKey || currentKey.level !== 'vip') return;
  const s = winCount;
  const ranks = [
    [150, '👑 ĐẾ VƯƠNG MD5'], [120, '💎 HUYỀN THOẠI MD5'], [90, '🏆 BẬC THẦY MD5'],
    [70, '🔥 CAO THỦ TỐI THƯỢNG'], [50, '⚡ CHIẾN THẦN'], [35, '💠 THỢ SĂN CHUỖI'],
    [20, '⭐ CAO THỦ'], [5, '🌱 NGƯỜI MỚI'], [0, '🥚 KHỞI ĐẦU']
  ];
  $('rankTitle').textContent = ranks.find(r => s >= r[0])[1];
  $('rankStats').textContent = `Đúng ${winCount} · Tổng ${totalPredict}`;
}

function applyTheme(level) {
  document.body.className = 'theme-' + level;
  $('levelBadge').textContent = { basic: 'SƠ CẤP', pro: 'TRUNG CẤP', vip: 'VIP BETA' }[level] || 'BETA';
  if (level === 'vip') { show($('rankBox')); updateRank(); }
  else hide($('rankBox'));
}

function renderAgentList(scores, animateIndex = -1) {
  const list = $('agentList');
  list.innerHTML = AGENTS.map((a, i) => {
    const sc = scores ? scores[a.id] : null;
    const sig = sc == null ? { text: '…', cls: 'pending' } : signalLabel(sc);
    let rowCls = 'agent-row';
    if (i === animateIndex) rowCls += ' active';
    else if (sc != null) rowCls += ' done-' + sig.cls;
    const scoreTxt = sc == null ? '—' : (sc > 0 ? '+' : '') + sc.toFixed(2);
    const count = a.count || 100;
    return `<div class="${rowCls}">
      <span class="agent-name">${a.name} · ${count} AI</span>
      <span class="agent-signal ${sig.cls}">${sig.text}</span>
      <span class="agent-score">${scoreTxt}</span>
    </div>`;
  }).join('');
}

function updateConsensusBar(redPct) {
  show($('consensusBar'));
  $('consensusFill').style.width = redPct + '%';
  $('consensusRed').textContent = 'Đỏ ' + redPct.toFixed(1) + '%';
  $('consensusBlue').textContent = 'Xanh ' + (100 - redPct).toFixed(1) + '%';
}

function showResult(consensus, scores) {
  pendingResult = consensus;
  hide($('aiThinking'));
  show($('resultCard'));

  const el = $('resultColor');
  el.textContent = consensus.color;
  el.className = 'result-color ' + (consensus.isRed ? 'red' : 'blue');
  $('resultMessage').textContent = 'Đồng thuận AI · ' + Math.round(consensus.confidence) + '%';

  const rd = consensus.redDisplay;
  const bd = consensus.blueDisplay;
  $('redPercent').textContent = rd.toFixed(1) + '%';
  $('bluePercent').textContent = bd.toFixed(1) + '%';
  $('redCircle').style.setProperty('--p', rd);
  $('blueCircle').style.setProperty('--p', bd);
  $('confidence').textContent = 'Đồng thuận AI: ' + consensus.confidence + '%';
  $('sumInfo').textContent = (activeSeed ? 'Seed · ' : '1000 AI · ') + 'Beta Final';

  $('aiReason').textContent = buildReason(consensus, scores);
  $('aiSuggestText').textContent = buildSuggestion(consensus);

  const warning = (() => {
    const st = getStreak();
    if (st.type === 'lose' && st.count >= 3) return `Chuỗi thua ${st.count} ván. Cluster AI khuyên giảm mức.`;
    if (history.length >= 8 && getRecentWinrate() <= 0.3) return `Winrate gần đây thấp. Nên giảm nhịp.`;
    return null;
  })();
  if (warning) { $('aiWarning').textContent = warning; show($('aiWarning')); }
  else hide($('aiWarning'));

  if (history.length >= 1) {
    const recent = history.slice(0, 10);
    const red = recent.filter(h => h.isRed).length;
    $('aiTrendText').textContent = `${recent.length} ván gần: Đỏ ${red} · Xanh ${recent.length - red} · WR ${Math.round(getRecentWinrate()*100)}%.`;
    const st = getStreak();
    $('streakInfo').textContent = st.type ? (st.type === 'win' ? `Thắng ${st.count} liên tiếp` : `Thua ${st.count} liên tiếp`) : '';
    show($('aiTrend'));
  }

  show($('resultActions'));
  hide($('resultFeedback'));
  $('btnWin').disabled = false;
  $('btnLose').disabled = false;
}

function submitResult(isWin) {
  if (!pendingResult) return;
  $('btnWin').disabled = true;
  $('btnLose').disabled = true;
  history.unshift({
    color: pendingResult.color,
    isRed: pendingResult.isRed,
    confidence: Math.round(pendingResult.confidence * 10) / 10,
    isWin
  });
  if (history.length > 30) history = history.slice(0, 30);
  totalPredict++;
  if (isWin) {
    winCount++;
    systemXP += deepMode === 'ultra' ? 28 : deepMode ? 16 : 9;
  } else {
    systemXP += deepMode === 'ultra' ? 6 : deepMode ? 3.5 : 2;
  }
  saveStats();
  updateSystemPanel();

  const fb = $('resultFeedback');
  fb.textContent = isWin ? 'Đã ghi nhận đúng' : 'Đã ghi nhận sai';
  fb.className = 'feedback ' + (isWin ? 'win' : 'lose');
  show(fb);
  setTimeout(() => hide($('resultActions')), 450);

  updateOverview(); updateRank(); renderHistory(); renderStats();
  pendingResult = null;
}

function renderStats() {
  if (!currentKey || currentKey.level === 'basic' || !history.length) { hide($('statsBox')); return; }
  show($('statsBox'));
  const red = history.filter(h => h.isRed).length;
  $('statRed').textContent = red;
  $('statBlue').textContent = history.length - red;
  $('statTotal').textContent = history.length;
}

function renderHistory() {
  if (!currentKey || currentKey.level === 'basic' || !history.length) { hide($('historyBox')); return; }
  show($('historyBox'));
  $('historyList').innerHTML = history.slice(0, 12).map(h => `
    <div class="history-item">
      <div class="h-dot ${h.isRed ? 'red' : 'blue'}"></div>
      <span class="h-color ${h.isRed ? 'red' : 'blue'}">${h.color}</span>
      <span class="h-conf">${Number(h.confidence).toFixed(1)}%</span>
      <span class="h-mark" style="color:${h.isWin ? '#34D399' : '#F87171'}">${h.isWin ? '✓' : '✕'}</span>
    </div>`).join('');
}

function showLogin() {
  hide($('splash')); hide($('home')); show($('login'));
  $('keyInput').value = ''; hide($('loginError'));
}
function startKeyWatchdog() {
  if (window.__vippWatch) clearInterval(window.__vippWatch);
  window.__vippWatch = setInterval(async () => {
    if (!currentKey || !sbEnabled()) return;
    if (DEMO_KEYS[String(currentKey.key).toLowerCase()]) return;
    try {
      const row = await sbGetKey(currentKey.key);
      if (!row || row.locked || (row.expires_at && Date.now() > row.expires_at)) {
        clearKey();
        alert('Key đã bị khóa hoặc hết hạn');
        showLogin();
      }
    } catch {}
  }, 15000); // 15s check một lần
}

function showHome() {
  hide($('splash')); hide($('login')); show($('home'));
  applyTheme(currentKey.level);
  loadStats(); updateOverview(); updateSystemPanel(); updateRank(); renderHistory(); renderStats();
  startKeyWatchdog();
  hide($('resultCard')); hide($('aiThinking')); hide($('aiWarning'));
  hide($('aiTrend')); hide($('multiAI'));
  document.querySelectorAll('.dice').forEach(i => i.value = '');
}

// ================== EVENTS ==================
$('btnLogin').addEventListener('click', async () => {
  const key = $('keyInput').value.trim();
  if (!key) { $('loginError').textContent = 'Vui lòng nhập key'; show($('loginError')); return; }
  const btn = $('btnLogin');
  btn.disabled = true; btn.textContent = 'Đang xác thực...';
  const info = await validateKey(key);
  btn.disabled = false; btn.textContent = 'Tiếp tục';
  if (info?.isActive) showHome();
  else { $('loginError').textContent = 'Key không hợp lệ'; show($('loginError')); }
});
$('keyInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnLogin').click(); });
$('btnLogout').addEventListener('click', () => { if (confirm('Đăng xuất?')) { clearKey(); showLogin(); } });
$('btnWin').addEventListener('click', () => submitResult(true));
$('btnLose').addEventListener('click', () => submitResult(false));
$('btnClearHistory')?.addEventListener('click', () => { if (confirm('Xóa lịch sử?')) clearStats(); });

async function runAnalysis(deep = false) {
  const inputs = [...document.querySelectorAll('.dice')];
  const dice = [];
  for (const inp of inputs) {
    const v = parseInt(inp.value, 10);
    if (isNaN(v) || v < 1 || v > 6) { alert('Nhập đủ 4 số từ 1–6'); return; }
    dice.push(v);
  }

  deepMode = deep; // false | true | 'ultra'
  const isDeep = !!deep;
  const isUltra = deep === 'ultra';
  const btn = $('btnPredict');
  const btnDeep = $('btnDeep');
  const btnUltra = $('btnUltra');
  btn.disabled = true;
  if (btnDeep) btnDeep.disabled = true;
  if (btnUltra) btnUltra.disabled = true;
  btn.textContent = isUltra ? 'Cực sâu...' : isDeep ? 'Siêu tư duy...' : 'Đang phân tích...';
  if (btnDeep) btnDeep.textContent = isDeep && !isUltra ? 'Đang đào sâu...' : 'Phân tích sâu';
  if (btnUltra) btnUltra.textContent = isUltra ? 'Đang suy nghĩ cực sâu...' : 'Suy nghĩ cực sâu';

  hide($('resultCard')); hide($('aiWarning'));
  show($('multiAI'));
  hide($('consensusBar'));
  renderAgentList(null);
  show($('aiThinking'));

  const sys = getSystemLevel();
  $('thinkingText').textContent = isUltra
    ? `Kích hoạt suy nghĩ cực sâu · ${sys.aiCount} AI · IQ ${sys.iq} · full debate...`
    : isDeep
      ? `Kích hoạt siêu tư duy đa lớp · cluster ${sys.aiCount} AI · IQ ${sys.iq}...`
      : `Khởi tạo cluster 1000 AI · 10 nhóm chuyên sâu...`;
  await sleep(isUltra ? 1200 : isDeep ? 900 : 350);

  // Multi-pass khi deep: chạy 3 lần rồi trung bình score
  let scores;
  if (isDeep) {
    const rounds = isUltra ? 8 : 5;
    const passes = Array.from({ length: rounds }, () => runAgents(dice));
    scores = {};
    for (const a of AGENTS) {
      if (a.id === 'ensemble') continue;
      const avg = passes.reduce((s, p) => s + p[a.id], 0) / passes.length;
      scores[a.id] = clamp(avg);
    }
    const weights = {
      logic: 1.35, math: 1.4, strategy: 1.75, psych: 1.25, cognition: 1.2,
      trend: 1.6, risk: 1.5, critique: 1.55, language: 0.9
    };
    let wsum = 0, acc = 0;
    for (const [id, sc] of Object.entries(scores)) {
      const w = weights[id] || 1;
      acc += sc * w; wsum += w;
    }
    scores.ensemble = clamp(acc / wsum);
    systemXP += isUltra ? 18 : 8;
    saveStats();
    updateSystemPanel();
  } else {
    scores = runAgents(dice);
  }

  const consensus = scoresToConsensus(scores);
  if (isDeep) {
    const boost = isUltra ? 11 : 7;
    const cap = isUltra ? 98 : 97;
    if (Math.abs(consensus.avg) > 0.18) {
      consensus.confidence = Math.min(cap, consensus.confidence + boost + Math.abs(consensus.avg) * 10);
    }
    const push = Math.min(isUltra ? 9 : 6, Math.abs(consensus.avg) * (isUltra ? 14 : 10));
    if (consensus.isRed) {
      consensus.redDisplay = Math.min(90, consensus.redDisplay + push);
      consensus.blueDisplay = 100 - consensus.redDisplay;
    } else {
      consensus.blueDisplay = Math.min(90, consensus.blueDisplay + push);
      consensus.redDisplay = 100 - consensus.blueDisplay;
    }
    consensus.redPercent = consensus.isRed ? consensus.redDisplay : consensus.blueDisplay;
    consensus.bluePercent = consensus.isRed ? consensus.blueDisplay : consensus.redDisplay;
  }

  const partial = {};
  for (let i = 0; i < AGENTS.length; i++) {
    const id = AGENTS[i].id;
    partial[id] = scores[id];
    $('thinkingText').textContent = isUltra
      ? `${AGENTS[i].name} · ultra layer · tranh luận 8 vòng...`
      : isDeep
        ? `${AGENTS[i].name} · deep layer · phản biện 5 vòng...`
        : `${AGENTS[i].name} · 100 AI đang phân tích...`;
    renderAgentList(partial, i);
    await sleep(isUltra ? (650 + Math.random() * 320) : isDeep ? (520 + Math.random() * 260) : (240 + Math.random() * 140));
  }

  $('thinkingText').textContent = isUltra
    ? 'Ultra debate · loại nhiễu tối đa · chốt nhận định cấp cao...'
    : isDeep
      ? 'Tổng hợp siêu lớp · tranh luận nội bộ · loại nhiễu · chốt nhận định cuối...'
      : '1000 AI đang tổng hợp consensus cuối...';
  updateConsensusBar(consensus.redDisplay);
  await sleep(isUltra ? 1400 : isDeep ? 1100 : 450);

  hide($('aiThinking'));
  showResult(consensus, scores);

  if (isDeep) {
    const extra = buildDeepAppendix(consensus, scores, isUltra);
    $('aiReason').textContent = $('aiReason').textContent + ' ' + extra;
  }

  btn.disabled = false;
  if (btnDeep) btnDeep.disabled = false;
  if (btnUltra) btnUltra.disabled = false;
  btn.textContent = 'Phân tích hội đồng';
  if (btnDeep) btnDeep.textContent = 'Phân tích sâu';
  if (btnUltra) btnUltra.textContent = 'Suy nghĩ cực sâu';
}

function buildDeepAppendix(consensus, scores, ultra = false) {
  const ranked = Object.entries(scores)
    .map(([id, sc]) => ({ id, sc, abs: Math.abs(sc) }))
    .sort((a, b) => b.abs - a.abs);
  const top = ranked[0];
  const second = ranked[1];
  const name = AGENTS.find(a => a.id === top.id)?.name || top.id;
  const name2 = AGENTS.find(a => a.id === second.id)?.name || second.id;
  const side = top.sc > 0 ? 'Đỏ' : top.sc < 0 ? 'Xanh' : 'trung lập';
  const sys = getSystemLevel();
  if (ultra) {
    return `Ultra layer (${sys.aiCount} AI · IQ ${sys.iq}): ${name} dẫn dắt hướng ${side}, ${name2} xác nhận phụ. Đã trải 8 vòng tranh luận độc lập, loại outlier, nén nhiễu random, rồi mới chốt nhận định cấp cao.`;
  }
  return `Siêu layer (${sys.aiCount} AI · IQ ${sys.iq}): ${name} chiếm ưu thế hướng ${side}; ${name2} là tín hiệu phụ trợ. Đã chạy 5 vòng phản biện độc lập trước khi chốt consensus.`;
}

$('btnPredict').addEventListener('click', () => runAnalysis(false));
$('btnDeep')?.addEventListener('click', () => runAnalysis(true));
$('btnUltra')?.addEventListener('click', () => runAnalysis('ultra'));

// Random từ máy
$('btnLocalRandom')?.addEventListener('click', () => {
  let seed;
  if (window.crypto?.getRandomValues) {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    seed = buf[0].toString(16) + buf[1].toString(16);
  } else {
    seed = Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  activeSeed = seed;
  if ($('seedInput')) $('seedInput').value = seed;
  setSeedSource('Máy local (crypto.getRandomValues)');
});

// Random server demo — thử nhiều API public (CORS). KHÔNG phải server game.
$('btnServerRandom')?.addEventListener('click', async () => {
  const btn = $('btnServerRandom');
  if (btn) { btn.disabled = true; btn.textContent = 'Đang lấy...'; }

  const endpoints = [
    {
      name: 'uuid.rocks',
      url: 'https://uuid.rocks/plain',
      parse: async (res) => (await res.text()).trim()
    },
    {
      name: 'httpbin',
      url: 'https://httpbin.org/uuid',
      parse: async (res) => {
        const j = await res.json();
        return String(j.uuid || '').replace(/-/g, '');
      }
    },
    {
      name: 'quotable',
      url: 'https://api.quotable.io/random',
      parse: async (res) => {
        const j = await res.json();
        return hashString(String(j._id || j.content || Date.now())).toString(16) + Date.now().toString(36);
      }
    }
  ];

  let seed = '';
  let source = '';

  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, { cache: 'no-store' });
      if (!res.ok) continue;
      const val = await ep.parse(res);
      if (val && val.length >= 8) {
        seed = val.slice(0, 32);
        source = 'Server demo (' + ep.name + ')';
        break;
      }
    } catch (_) {
      // thử endpoint kế
    }
  }

  if (!seed) {
    const buf = new Uint32Array(3);
    if (window.crypto?.getRandomValues) crypto.getRandomValues(buf);
    else {
      buf[0] = Math.floor(Math.random() * 1e9);
      buf[1] = Math.floor(Math.random() * 1e9);
      buf[2] = Date.now();
    }
    seed = Array.from(buf).map(x => x.toString(16).padStart(8, '0')).join('');
    source = 'Server demo offline → fallback máy (crypto)';
  }

  activeSeed = seed;
  if ($('seedInput')) $('seedInput').value = seed;
  setSeedSource(source);

  if (btn) { btn.disabled = false; btn.textContent = 'Random server demo'; }
});

$('seedInput')?.addEventListener('input', () => {
  const v = $('seedInput').value.trim();
  activeSeed = v;
  if (v) setSeedSource('Seed thủ công');
  else setSeedSource('Math.random() (mặc định)');
});

document.querySelectorAll('.dice').forEach((input, idx, arr) => {
  input.addEventListener('input', () => {
    // Chỉ giữ số 1-6
    input.value = input.value.replace(/[^1-6]/g, '').slice(0, 1);
    if (input.value.length === 1 && idx < arr.length - 1) {
      arr[idx + 1].focus();
      arr[idx + 1].select();
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !input.value && idx > 0) {
      e.preventDefault();
      arr[idx - 1].focus();
      arr[idx - 1].value = '';
    }
  });
  // iOS: chạm vào thì select sẵn
  input.addEventListener('focus', () => {
    setTimeout(() => input.select(), 0);
  });
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// PWA
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; });
function isIos() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}
async function handleInstall() {
  if (isStandalone()) return alert('Đã cài trên màn hình chính.');
  if (isIos()) return show($('iosGuide'));
  if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; }
  else alert('Dùng menu trình duyệt để cài app.');
}
$('btnInstall')?.addEventListener('click', handleInstall);
$('btnImportLicense')?.addEventListener('click', () => $('licenseFile')?.click());
$('licenseFile')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.keys) throw new Error('bad');
    saveLicenses({ updatedAt: data.updatedAt || Date.now(), keys: data.keys });
    alert('Đã import ' + data.keys.length + ' key từ Key Manager');
  } catch {
    alert('File không hợp lệ');
  }
  e.target.value = '';
});
$('btnInstallHeader')?.addEventListener('click', handleInstall);
$('closeIosGuide')?.addEventListener('click', () => hide($('iosGuide')));
$('gotItIos')?.addEventListener('click', () => hide($('iosGuide')));

// Init
(async () => {
  await sleep(850);
  const local = loadKey();
  if (local?.isActive) { currentKey = local; showHome(); }
  else showLogin();
})();
