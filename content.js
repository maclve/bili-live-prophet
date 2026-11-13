// B站直播「预言」竞猜 —— 网页端面板
// 接口与手机 App 内嵌面板 (live-app-guessing-game) 完全一致：
//   GET  /xlive/app-ucenter/v1/elden/get_by_user      当前主播的预言列表 + 我的硬币
//   GET  /xlive/app-ucenter/v1/elden/is_in_fans_group 下注前复查硬币余额
//   POST /xlive/app-ucenter/v1/elden/user_join        参与预言（消耗硬币门票）
//   GET  /xlive/app-ucenter/v1/elden/hsitory_user     我的预言历史（官方接口拼写如此）
(() => {
  'use strict';

  const TEST = window.__BLP_TEST__ || null; // 仅本地测试页使用
  const API = 'https://api.live.bilibili.com';
  const STATUS = ['未开始', '进行中', '等待结算', '已经结束', '主播取消'];
  const POLL_OPEN = 4000; // 面板打开时，与 App 一致 4 秒刷新
  const POLL_CLOSED = 20000; // 面板收起时低频检查，用于提示「进行中」
  const POS_KEY = 'blp-fab-pos';

  const m = location.pathname.match(/^\/(?:blanc\/|h5\/)?(\d+)\/?$/);
  const urlRoomId = TEST ? TEST.roomId : m && m[1];
  if (!urlRoomId || window.__blpLoaded) return;
  window.__blpLoaded = true;

  const cookie = (k) => {
    const r = document.cookie.match(new RegExp('(?:^|;\\s*)' + k + '=([^;]*)'));
    return r ? decodeURIComponent(r[1]) : '';
  };

  const state = {
    uid: 0,
    anchorId: 0,
    open: false,
    view: 'list', // list | history
    prophets: [],
    coins: null,
    history: null,
    error: '',
    loaded: false,
    serverOffset: 0, // 服务器时间 - 本地时间 (ms)
    busy: false,
  };

  // ---------- 网络 ----------
  async function get(path, params) {
    const qs = new URLSearchParams(params || {}).toString();
    const r = await fetch(`${API}${path}${qs ? '?' + qs : ''}`, { credentials: 'include' });
    return r.json();
  }

  async function post(path, data) {
    const csrf = cookie('bili_jct');
    const body = new URLSearchParams({ ...data, csrf_token: csrf, csrf, visit_id: '' });
    const r = await fetch(`${API}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    return r.json();
  }

  async function init() {
    state.uid = TEST ? TEST.uid : Number(cookie('DedeUserID')) || 0;
    try {
      const r = await get('/room/v1/Room/room_init', { id: urlRoomId });
      if (r.code === 0) state.anchorId = r.data.uid;
    } catch (e) { /* 下面统一报错 */ }
    try {
      const t = await get('/xlive/open-interface/v1/rtc/getTimestamp');
      if (t.code === 0 && t.data && t.data.timestamp) {
        state.serverOffset = t.data.timestamp * 1000 - Date.now();
      }
    } catch (e) { /* 用本地时间兜底 */ }
  }

  async function refresh() {
    if (!state.uid) { state.error = 'login'; state.loaded = true; return render(); }
    if (!state.anchorId) { state.error = '获取主播信息失败，请刷新页面重试'; state.loaded = true; return render(); }
    try {
      const r = await get('/xlive/app-ucenter/v1/elden/get_by_user', {
        anchor_id: state.anchorId, uid: state.uid, with_history: true,
      });
      if (r.code === 0) {
        state.error = '';
        state.prophets = (r.data && r.data.prophets) || [];
        state.coins = r.data ? r.data.user_smh_num : null;
      } else if (r.code === -101) {
        state.error = 'login';
      } else {
        state.error = r.message || `请求失败 (${r.code})`;
      }
    } catch (e) {
      state.error = '网络错误，稍后自动重试';
    }
    state.loaded = true;
    render();
  }

  async function loadHistory() {
    state.history = null;
    render();
    try {
      const r = await get('/xlive/app-ucenter/v1/elden/hsitory_user', { uid: state.uid });
      state.history = r.code === 0 ? (r.data.prophet_history || []) : [];
    } catch (e) {
      state.history = [];
    }
    render();
  }

  // 预言成功可得硬币：与 App 相同的算法
  function reward(p, side, joining) {
    const a = p.answer_count.a || 0, b = p.answer_count.b || 0;
    const mine = (side === 1 ? a : b) + (joining ? 1 : 0) || 1;
    const other = side === 1 ? b : a;
    return Math.floor((p.smh_spend * other) / mine);
  }

  const secondsLeft = (p) =>
    Math.floor((p.count_down_time * 1000 - (Date.now() + state.serverOffset)) / 1000);

  async function join(item, side) {
    const p = item.prophet;
    if (state.busy) return;
    if (state.uid === state.anchorId) return toast('不支持主播参与自己开启的预言');
    if (p.prophet_status === 1 && item.my_answer > 0) {
      if (item.my_answer !== side) toast('不可以选择两个不同的答案');
      return;
    }
    if (p.prophet_status !== 1 || secondsLeft(p) < 1) return;

    const answer = side === 1 ? p.question.answer_a : p.question.answer_b;
    const ok = await confirmBox(
      p.question.question,
      `我猜：${answer}\n门票：${p.smh_spend} 硬币\n猜对将获得：${reward(p, side, true)}（硬币）`,
      '确认', '再想想'
    );
    if (!ok) return;

    state.busy = true;
    try {
      const g = await get('/xlive/app-ucenter/v1/elden/is_in_fans_group', {
        anchor_id: state.anchorId, uid: state.uid,
      });
      const coins = g.code === 0 && g.data ? g.data.smh_num : 0;
      if (!coins || coins < p.smh_spend) {
        await confirmBox('硬币不足', `参与预言需要消耗 ${p.smh_spend} 硬币，\n您当前硬币不足`, '知道了', '');
        return;
      }
      const r = await post('/xlive/app-ucenter/v1/elden/user_join', {
        anchor_id: state.anchorId, uid: state.uid, prophet_id: p.prophet_id, answer: side,
      });
      if (r.code === 0) {
        item.my_answer = side;
        toast('完成预言，请等待结算');
      } else {
        toast(`投票失败${r.message ? '：' + r.message : ''}`);
      }
    } catch (e) {
      toast('投票失败：网络错误');
    } finally {
      state.busy = false;
      refresh();
    }
  }

  // ---------- 界面 ----------
  const host = document.createElement('div');
  host.id = 'blp-host';
  host.style.cssText = 'position:fixed;z-index:2147483000;top:0;left:0;width:0;height:0;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
  .fab { position: fixed; right: 16px; top: 45%; width: 48px; height: 48px; border-radius: 50%;
    background: #12101a; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; user-select: none;
    display: none; align-items: center; justify-content: center; border: 2px solid #5b4bd6;
    box-shadow: 0 4px 14px rgba(0,0,0,.35); }
  .fab.live { border-color: #ff6699; }
  .fab .dot { position: absolute; top: -2px; right: -2px; width: 12px; height: 12px; border-radius: 50%;
    background: #ff6699; border: 2px solid #12101a; display: none; }
  .fab.live .dot { display: block; }
  .panel { position: fixed; right: 76px; top: 12%; width: 360px; max-width: calc(100vw - 96px); max-height: 76vh;
    background: #12101a; color: #fff; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,.5);
    display: none; flex-direction: column; overflow: hidden; font-size: 13px; }
  .panel.open { display: flex; }
  .hd { padding: 14px 16px 8px; display: flex; align-items: center; gap: 8px; }
  .hd .t { font-size: 16px; font-weight: 600; flex: 1; }
  .hd .x, .hd .back { cursor: pointer; color: #9a97a8; font-size: 18px; line-height: 1; padding: 2px 4px; }
  .rule { padding: 0 16px 10px; color: #9a97a8; font-size: 12px; line-height: 1.5; }
  .body { overflow-y: auto; padding: 0 12px 8px; flex: 1; min-height: 120px;
    scrollbar-width: thin; scrollbar-color: #3a3650 transparent; }
  .empty { color: #9a97a8; text-align: center; padding: 40px 12px; line-height: 1.7; }
  .empty a { color: #8f7dff; }
  .card { background: #1f1c2b; border-radius: 10px; padding: 12px; margin-bottom: 10px; }
  .row { display: flex; align-items: flex-start; gap: 8px; }
  .q { flex: 1; font-size: 14px; font-weight: 600; line-height: 1.4; word-break: break-word; }
  .meta { text-align: right; color: #9a97a8; font-size: 12px; white-space: nowrap; line-height: 1.6; }
  .meta b { color: #fff; font-weight: 600; font-variant-numeric: tabular-nums; }
  .pink { color: #ff6699 !important; }
  .opts { display: flex; gap: 8px; margin-top: 10px; align-items: stretch; }
  .vs { align-self: center; color: #6d6a7c; font-size: 12px; font-weight: 700; }
  .opt { flex: 1; border-radius: 8px; padding: 10px 6px; text-align: center; background: #2a2738;
    border: 2px solid transparent; min-height: 56px; display: flex; flex-direction: column; justify-content: center; gap: 4px; }
  .opt.can { cursor: pointer; }
  .opt.a.can:hover, .opt.a.sel { border-color: #4f8cff; background: #1d2a4a; }
  .opt.b.can:hover, .opt.b.sel { border-color: #ff6699; background: #45203a; }
  .opt .name { font-size: 14px; font-weight: 600; word-break: break-word; }
  .opt .sub { font-size: 11px; color: #b9b6c6; }
  .opt .tag { font-size: 11px; font-weight: 600; }
  .opt .tag.win { color: #5fd38d; } .opt .tag.lose { color: #8b889a; }
  .bar { display: flex; height: 6px; border-radius: 3px; overflow: hidden; margin-top: 10px; background: #2a2738; }
  .bar i { display: block; height: 100%; } .bar .ba { background: #4f8cff; } .bar .bb { background: #ff6699; }
  .cnt { display: flex; justify-content: space-between; color: #9a97a8; font-size: 11px; margin-top: 4px;
    font-variant-numeric: tabular-nums; }
  .ft { padding: 10px 16px; border-top: 1px solid #262335; display: flex; justify-content: space-between; color: #b9b6c6; }
  .ft .link { cursor: pointer; color: #8f7dff; }
  .hi { background: #1f1c2b; border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; line-height: 1.7; }
  .hi .s { color: #9a97a8; font-size: 12px; }
  .mask { position: fixed; inset: 0; background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center; }
  .dlg { width: 300px; background: #fff; color: #18191c; border-radius: 12px; padding: 20px 18px 14px; }
  .dlg h4 { margin: 0 0 10px; font-size: 16px; text-align: center; word-break: break-word; }
  .dlg p { margin: 0 0 16px; white-space: pre-line; text-align: center; color: #61666d; line-height: 1.7; font-size: 14px; }
  .dlg .btns { display: flex; gap: 10px; }
  .dlg button { flex: 1; height: 36px; border-radius: 8px; border: 1px solid #e3e5e7; background: #fff; cursor: pointer; font-size: 14px; }
  .dlg button.ok { background: #ff6699; border-color: #ff6699; color: #fff; }
  .toast { position: fixed; left: 50%; top: 20%; transform: translateX(-50%); background: rgba(0,0,0,.82); color: #fff;
    padding: 10px 18px; border-radius: 8px; font-size: 14px; max-width: 80vw; }
</style>
<div class="fab" title="直播预言（竞猜）"><span>预言</span><i class="dot"></i></div>
<div class="panel">
  <div class="hd"><span class="back" hidden>‹</span><span class="t">预言</span><span class="x" title="收起">×</span></div>
  <div class="rule">参与规则：消耗一定硬币作为预言门票，预言正确会获得额外的硬币奖励</div>
  <div class="body"></div>
  <div class="ft"><span class="coins"></span><span class="link hist">预言历史</span></div>
</div>
<div class="layer"></div>`;

  const $ = (s) => root.querySelector(s);
  const fab = $('.fab'), panel = $('.panel'), body = $('.body'), layer = $('.layer');

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mmss = (s) => {
    s = Math.max(0, s);
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };
  const fmtTime = (ts) => {
    const d = new Date(ts * 1000), p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  function confirmBox(title, content, okText, cancelText) {
    return new Promise((resolve) => {
      const mask = document.createElement('div');
      mask.className = 'mask';
      mask.innerHTML = `<div class="dlg"><h4>${esc(title)}</h4><p>${esc(content)}</p><div class="btns">
        ${cancelText ? `<button class="no">${esc(cancelText)}</button>` : ''}<button class="ok">${esc(okText)}</button></div></div>`;
      const done = (v) => { mask.remove(); resolve(v); };
      mask.querySelector('.ok').onclick = () => done(true);
      const no = mask.querySelector('.no');
      if (no) no.onclick = () => done(false);
      layer.appendChild(mask);
    });
  }

  function cardHtml(item, idx) {
    const p = item.prophet, st = p.prophet_status, my = item.my_answer || 0;
    const left = secondsLeft(p);
    const canJoin = st === 1 && left > 0 && my === 0;
    let meta = '';
    if (st === 1 && left > 0) {
      meta = `门票 <b>${p.smh_spend}</b> 硬币<br><b class="cd" data-i="${idx}">${mmss(left)}</b> 截止`;
    } else if (st === 3) {
      if (my > 0) {
        const win = my === p.correct_answer;
        meta = `<b class="${win ? 'pink' : ''}">${win ? '+' + reward(p, my, false) : '-' + p.smh_spend}</b> 硬币`;
      } else meta = '未参与';
    } else {
      meta = st === 1 ? '已截止' : (STATUS[st] || '');
    }
    const opt = (side) => {
      const cls = side === 1 ? 'a' : 'b';
      const name = side === 1 ? p.question.answer_a : p.question.answer_b;
      const sel = my === side && st !== 4 && st !== 0;
      let sub = '';
      if ((st === 1 || st === 2) && my === side) sub = `已选 · 预言成功得 ${reward(p, side, false)} 硬币`;
      else if (canJoin) sub = `猜对约得 ${reward(p, side, true)} 硬币`;
      let tag = '';
      if (p.correct_answer > 0) {
        tag = p.correct_answer === side ? '<span class="tag win">✓ 正确答案</span>' : '<span class="tag lose">✗</span>';
      }
      return `<div class="opt ${cls}${sel ? ' sel' : ''}${canJoin ? ' can' : ''}" data-i="${idx}" data-side="${side}">
        <span class="name">${esc(name)}</span>${sub ? `<span class="sub">${sub}</span>` : ''}${tag}</div>`;
    };
    const a = p.answer_count.a || 0, b = p.answer_count.b || 0, tot = a + b;
    const pa = tot ? (a / tot) * 100 : 50;
    return `<div class="card">
      <div class="row"><div class="q">${esc(p.question.question)}</div><div class="meta">${meta}</div></div>
      <div class="opts">${opt(1)}<span class="vs">VS</span>${opt(2)}</div>
      <div class="bar"><i class="ba" style="width:${pa}%"></i><i class="bb" style="width:${100 - pa}%"></i></div>
      <div class="cnt"><span>${a} 人 · ${a * p.smh_spend} 硬币</span><span>${b * p.smh_spend} 硬币 · ${b} 人</span></div>
    </div>`;
  }

  function historyHtml(item) {
    const p = item.prophet, st = p.prophet_status;
    const key = ['', 'answer_a', 'answer_b'][p.correct_answer];
    const status = st === 3 ? fmtTime(p.publish_time) : (STATUS[st] || '');
    const ch = item.smh_num_change;
    const coin = item.my_answer < 1 || st !== 3 ? '--' : ch > 0 ? '+' + ch : ch < 0 ? String(ch) : ch === 0 ? '0' : '--';
    const mine = ['', p.question.answer_a, p.question.answer_b][item.my_answer] || '--';
    return `<div class="hi"><div class="row"><div class="q">${esc(p.question.question)}</div><div class="meta">${esc(status)}</div></div>
      <div><span class="s">题目答案：</span>${esc(key ? p.question[key] : '--')}　<span class="s">我猜：</span>${esc(mine)}　<span class="s">硬币：</span><span class="${ch > 0 ? 'pink' : ''}">${coin}</span></div>
      <div><span class="s">主播名称：</span>${esc(item.anchor_name)}</div></div>`;
  }

  function render() {
    const live = state.prophets.some((i) => i.prophet.prophet_status === 1 && secondsLeft(i.prophet) > 0);
    fab.classList.toggle('live', live);
    entryBtn.classList.toggle('live', live);
    panel.classList.toggle('open', state.open);
    if (!state.open) return;
    placePanel();

    const hist = state.view === 'history';
    $('.back').hidden = !hist;
    $('.t').textContent = hist ? '我的预言' : '预言';
    $('.rule').hidden = hist;
    $('.ft').hidden = hist;
    $('.coins').textContent = state.coins == null ? '' : `我的硬币：${state.coins}`;

    const scroll = body.scrollTop;
    if (hist) {
      body.innerHTML = state.history == null ? '<div class="empty">加载中…</div>'
        : state.history.length ? state.history.map(historyHtml).join('') + '<div class="empty" style="padding:12px">最多支持查看 100 条预言历史</div>'
          : '<div class="empty">暂无预言</div>';
    } else if (state.error === 'login') {
      body.innerHTML = '<div class="empty">请先登录 B 站账号后再参与预言<br><a href="https://passport.bilibili.com/login" target="_blank" rel="noopener">去登录</a>（登录后刷新本页）</div>';
    } else if (state.error) {
      body.innerHTML = `<div class="empty">${esc(state.error)}</div>`;
    } else if (!state.loaded) {
      body.innerHTML = '<div class="empty">加载中…</div>';
    } else if (!state.prophets.length) {
      body.innerHTML = '<div class="empty">主播还没开始预言，可以发弹幕提醒主播哦～</div>';
    } else {
      body.innerHTML = state.prophets.map(cardHtml).join('');
    }
    body.scrollTop = scroll;
  }

  body.addEventListener('click', (e) => {
    const opt = e.target.closest('.opt');
    if (!opt || state.view !== 'list') return;
    const item = state.prophets[Number(opt.dataset.i)];
    if (item) join(item, Number(opt.dataset.side));
  });
  $('.x').onclick = () => { state.open = false; render(); schedule(); };
  $('.hist').onclick = () => { state.view = 'history'; loadHistory(); };
  $('.back').onclick = () => { state.view = 'list'; render(); };

  // 悬浮按钮：可拖动，点击开关面板
  (() => {
    try {
      const pos = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (pos) { fab.style.top = pos.top + 'px'; fab.style.right = pos.right + 'px'; }
    } catch (e) { /* 忽略 */ }
    let drag = null;
    fab.addEventListener('pointerdown', (e) => {
      const r = fab.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, top: r.top, right: innerWidth - r.right, moved: false };
      fab.setPointerCapture(e.pointerId);
    });
    fab.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      drag.moved = true;
      fab.style.top = Math.min(innerHeight - 52, Math.max(4, drag.top + dy)) + 'px';
      fab.style.right = Math.min(innerWidth - 52, Math.max(4, drag.right - dx)) + 'px';
    });
    fab.addEventListener('pointerup', () => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      if (moved) {
        try {
          localStorage.setItem(POS_KEY, JSON.stringify({
            top: parseFloat(fab.style.top), right: parseFloat(fab.style.right),
          }));
        } catch (e) { /* 忽略 */ }
        return;
      }
      toggle();
    });
  })();

  function toggle() {
    state.open = !state.open;
    state.view = 'list';
    render();
    if (state.open) refresh();
    schedule();
  }

  // 嵌入直播间底部礼物栏左侧（「工坊订单」旁边）的入口按钮。
  // 找不到礼物栏（活动页、全屏等）时退回右侧悬浮按钮。
  const entry = document.createElement('div');
  entry.id = 'blp-entry';
  entry.style.cssText = 'position:absolute;top:50%;transform:translateY(-50%);z-index:5;';
  const entryRoot = entry.attachShadow({ mode: 'open' });
  entryRoot.innerHTML = `
<style>
  .e { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 52px; cursor: pointer;
    user-select: none; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
  .ic { position: relative; width: 38px; height: 38px; border-radius: 50%; background: #f1f2f3;
    display: flex; align-items: center; justify-content: center; font-size: 20px; line-height: 1; }
  .e:hover .ic { background: #e3e5e7; }
  .lb { font-size: 12px; line-height: 16px; white-space: nowrap; color: var(--text1, #18191c); }
  .dot { position: absolute; top: 0; right: 0; width: 9px; height: 9px; border-radius: 50%;
    background: #ff6699; border: 2px solid #fff; display: none; }
  .e.live .dot { display: block; }
</style>
<div class="e" title="直播预言（竞猜）"><div class="ic">🔮<i class="dot"></i></div><span class="lb">预言</span></div>`;
  const entryBtn = entryRoot.querySelector('.e');
  const entryLabel = entryRoot.querySelector('.lb');
  entryBtn.addEventListener('click', toggle);

  let embedded = false, everEmbedded = false;
  const startedAt = Date.now(), FAB_GRACE = 8000;
  function mountEntry() {
    const bar = document.querySelector('#gift-control-vm .left-part-ctnr');
    const barRect = bar && bar.getBoundingClientRect();
    const ok = !!bar && barRect.height > 0 && !document.fullscreenElement;
    if (ok) {
      if (entry.parentElement !== bar) bar.appendChild(entry);
      // 排在左侧已有入口（如「工坊订单」）的右边
      let right = barRect.left, top = Infinity, textEl = null;
      bar.querySelectorAll('*').forEach((el) => {
        if (el === entry || el.children.length) return; // 只量叶子节点，避免被撑满的容器干扰
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        if (r.right > right) right = r.right;
        if (r.top < top) top = r.top;
        if (!textEl && el.textContent.trim()) textEl = el;
      });
      // 文字颜色/字号跟随相邻入口（没有则跟随礼物名），以适配深色皮肤的直播间
      let color, fontSize = '';
      if (textEl) {
        const ts = getComputedStyle(textEl);
        color = ts.color;
        fontSize = ts.fontSize;
      } else {
        // 取礼物栏里出现最多的文字颜色（礼物名），角标之类的少数颜色不算；并列时取字号大的
        const groups = {};
        document.querySelectorAll('#gift-control-vm .gift-panel *').forEach((el) => {
          if (el.children.length || !el.textContent.trim() || el.getBoundingClientRect().width <= 0) return;
          const ts = getComputedStyle(el);
          const g = groups[ts.color] || (groups[ts.color] = { n: 0, size: 0 });
          g.n++;
          g.size = Math.max(g.size, parseFloat(ts.fontSize) || 0);
        });
        const best = Object.entries(groups).sort((x, y) => y[1].n - x[1].n || y[1].size - x[1].size)[0];
        color = best ? best[0] : getComputedStyle(bar).color;
      }
      entryLabel.style.color = color;
      entryLabel.style.fontSize = fontSize;
      const left = Math.round(right - barRect.left + (right > barRect.left ? 14 : 8));
      if (entry.style.left !== left + 'px') entry.style.left = left + 'px';
      // 有相邻入口时与它的图标顶端对齐，否则垂直居中
      const aligned = top !== Infinity;
      const topCss = aligned ? Math.round(top - barRect.top) + 'px' : '50%';
      if (entry.style.top !== topCss) {
        entry.style.top = topCss;
        entry.style.transform = aligned ? 'none' : 'translateY(-50%)';
      }
    } else if (entry.parentElement) {
      entry.remove();
    }
    if (ok) everEmbedded = true;
    if (ok !== embedded) {
      embedded = ok;
      render();
    }
    // 悬浮按钮只作兜底：礼物栏出现过、或等了几秒仍没有时才显示，避免打开页面时闪一下
    const showFab = !ok && (everEmbedded || Date.now() - startedAt > FAB_GRACE);
    fab.style.display = showFab ? 'flex' : 'none';
    if (state.open) placePanel();
  }

  // 面板位置：嵌入时贴在入口按钮上方，否则用默认的右侧位置
  function placePanel() {
    if (!embedded) {
      panel.style.left = panel.style.bottom = panel.style.top = panel.style.right = panel.style.maxHeight = '';
      return;
    }
    const r = entry.getBoundingClientRect();
    const w = Math.min(360, innerWidth - 16);
    panel.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
    panel.style.right = 'auto';
    const above = r.top - 16, below = innerHeight - r.bottom - 16;
    if (above >= 300 || above >= below) { // 上方放得下（或比下方宽裕）就贴在按钮上方
      panel.style.top = 'auto';
      panel.style.bottom = innerHeight - r.top + 8 + 'px';
      panel.style.maxHeight = Math.max(160, Math.min(innerHeight * 0.76, above)) + 'px';
    } else {
      panel.style.bottom = 'auto';
      panel.style.top = r.bottom + 8 + 'px';
      panel.style.maxHeight = Math.max(160, Math.min(innerHeight * 0.76, below)) + 'px';
    }
  }
  setInterval(mountEntry, 1000);
  addEventListener('resize', mountEntry);
  addEventListener('scroll', () => { if (state.open) placePanel(); }, { passive: true, capture: true });

  // 倒计时每秒走字；到点后重绘以关闭下注
  setInterval(() => {
    if (!state.open || state.view !== 'list') return;
    let expired = false;
    root.querySelectorAll('.cd').forEach((el) => {
      const item = state.prophets[Number(el.dataset.i)];
      if (!item) return;
      const s = secondsLeft(item.prophet);
      if (s <= 0) expired = true; else el.textContent = mmss(s);
    });
    if (expired && !layer.querySelector('.mask')) render();
  }, 1000);

  // 轮询：页面不可见时暂停
  let timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!document.hidden && state.error !== 'login' && !layer.querySelector('.mask')) await refresh();
      schedule();
    }, state.open ? POLL_OPEN : POLL_CLOSED);
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.loaded && state.error !== 'login') refresh();
  });

  (document.body || document.documentElement).appendChild(host);
  mountEntry();
  init().then(refresh).then(schedule);
})();
