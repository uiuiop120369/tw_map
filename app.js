/* 대만 남부 여행 웹앱 — 서버 없이 동작하는 정적 앱
   - 영업 여부는 대만 시각(UTC+8)과 구글맵 요일별 영업시간(periods)으로 계산
   - 근처 알림: 사용자가 설정에서 켰을 때만, 화면이 열려 있는 동안 위치를 확인 */
(function () {
  'use strict';
  const D = window.TRIP_DATA;
  const ITEMS = D.items;
  const BY_ID = Object.fromEntries(ITEMS.map(x => [x.id, x]));
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DAYK = ['일', '월', '화', '수', '목', '금', '토'];
  const ICON = { food: '🍜', cafe: '☕', bakery: '🥐', shop: '🛍', sight: '🏯', market: '🏮', hotel: '🏨' };
  const COLOR = { food: '#c0392b', cafe: '#27804c', bakery: '#e67e22', shop: '#8e44ad', sight: '#2c3e50', market: '#d35400', hotel: '#f1c40f' };
  // 세분류(음식점·카페 세부 종류): [이모티콘, 이름] / 목록에서 보여주는 순서
  const SUB = { noodle: ['🍜', '면·우육면'], dump: ['🥟', '만두·딤섬'], rice: ['🍚', '밥·샤오츠(간식)'], take: ['🥡', '포장·길거리 간식'], hotpot: ['🍲', '훠궈·탕'], sea: ['🦐', '해산물'],
    dish: ['🥢', '대만·중국요리'], break: ['🥞', '대만식 아침'], bar: ['🍺', '술집·바'],
    cafe: ['☕', '카페'], drink: ['🧋', '차·밀크티'], ice: ['🍧', '빙수·더우화·아이스'], cake: ['🍰', '케이크·디저트'], bread: ['🍞', '빵집'], pine: ['🍍', '펑리수'] };
  const SUB_ORDER = { food: ['noodle', 'dump', 'rice', 'take', 'hotpot', 'sea', 'dish', 'break', 'bar'], cafe: ['cafe', 'drink', 'ice', 'cake', 'bread', 'pine'] };
  const SUB_SHORT = { noodle: '면', dump: '만두', rice: '밥·간식', take: '포장', hotpot: '훠궈', sea: '해산물', dish: '요리', break: '아침', bar: '술집', cafe: '카페', drink: '차·음료', ice: '빙수', cake: '케이크', bread: '빵', pine: '펑리수' };
  const iconOf = it => (SUB[it.sub] || [])[0] || ICON[it.type] || '📍';
  const SRC_ICON = { '미쉐린 빕구르망': '🏅', '구글 고평점': '⭐', '카페 추천': '📝', '펑리수 유명점': '🍍', '2026 신규': '🆕', '대만 대표 체인': '🇹🇼' };

  // ---------- 저장 ----------
  const LS = {
    get(k, d) { try { return JSON.parse(localStorage.getItem('tw_' + k)) ?? d; } catch (e) { return d; } },
    set(k, v) { localStorage.setItem('tw_' + k, JSON.stringify(v)); }
  };
  const S = Object.assign({ city: '전체', type: 'all', openOnly: true, when: 'now', locOn: true, alertOn: false, radius: 300,
    atypes: ['food', 'cafe', 'shop', 'sight'], wakeOn: false, zoom: 1, mapType: 'osm', poiOn: true }, LS.get('settings', {}));
  const saveS = () => LS.set('settings', S);
  let fav = new Set(LS.get('fav', []));
  let myRsv = LS.get('rsv', {});   // 내 예약: {가게id: {u: 예약확인 링크, w: '11/15 18:30'}}
  let visited = new Set(LS.get('visited', []));
  let alerted = LS.get('alerted', {});
  let myPos = null;      // {lat, lng, acc}
  let watchId = null;

  // ---------- 시간 (대만 기준) ----------
  // 기준 시각 프리셋: 여행 전 미리 계획할 때 사용
  const PRESETS = [
    ['now', '⏱ 지금 (대만 시각)'],
    ['2026-11-13T16:00', '11/13(금) 16시 · 타이난 도착 후'],
    ['2026-11-13T19:00', '11/13(금) 19시 · 타이난 저녁'],
    ['2026-11-14T09:00', '11/14(토) 9시 · 타이난 아침'],
    ['2026-11-14T15:00', '11/14(토) 15시 · 가오슝 도착'],
    ['2026-11-14T19:00', '11/14(토) 19시 · 가오슝 저녁'],
    ['2026-11-15T09:00', '11/15(일) 9시 · 아침'],
    ['2026-11-15T13:00', '11/15(일) 13시 · 점심'],
    ['2026-11-15T19:00', '11/15(일) 19시 · 저녁'],
    ['2026-11-16T09:00', '11/16(월) 9시 · 출국일 아침']];
  function twNow() {
    if (S.when !== 'now') {
      const [d, t] = S.when.split('T'); const [y, m, dd] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, dd, h, mi));
      return { day: dt.getUTCDay(), min: h * 60 + mi, label: PRESETS.find(p => p[0] === S.when)[1] };
    }
    const n = new Date(Date.now() + 8 * 3600e3); // UTC+8
    return { day: n.getUTCDay(), min: n.getUTCHours() * 60 + n.getUTCMinutes(), label: '지금' };
  }
  const hm = m => { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

  // periods → 주간 분 단위 구간 목록
  function weekIntervals(periods) {
    const out = [];
    for (const p of periods || []) {
      if (!p.open) continue;
      if (!p.close) { out.push([0, 10080]); continue; }
      const o = p.open.day * 1440 + (p.open.hour || 0) * 60 + (p.open.minute || 0);
      let c = p.close.day * 1440 + (p.close.hour || 0) * 60 + (p.close.minute || 0);
      if (c <= o) c += 10080;
      out.push([o, c]);
    }
    return out;
  }
  // 영업 상태: open / closing(1시간 내 마감) / later(오늘 나중에 오픈) / closed(오늘 영업 끝 또는 휴무) / unknown
  function openInfo(it, t) {
    const iv = weekIntervals(it.periods);
    if (!iv.length) return { st: 'unknown', txt: '영업시간 정보 없음' };
    const w = t.day * 1440 + t.min;
    for (const [o, c] of iv) {
      for (const ww of [w, w + 10080]) {
        if (ww >= o && ww < c) {
          if (c - o >= 10080) return { st: 'open', txt: '24시간 영업' };
          const left = c - ww;
          return { st: left <= 60 ? 'closing' : 'open', txt: (left <= 60 ? '곧 마감 ' : '영업 중 ~') + hm(c) };
        }
      }
    }
    let next = Infinity;
    for (const [o] of iv) for (const oo of [o, o + 10080]) if (oo > w && oo < next) next = oo;
    if (next === Infinity) return { st: 'closed', txt: '휴무' };
    const sameDay = Math.floor(next / 1440) % 7 === t.day && next - w < 1440;
    if (sameDay) return { st: 'later', txt: '오늘 ' + hm(next) + ' 오픈' };
    return { st: 'closed', txt: '오늘 영업 끝 · ' + DAYK[Math.floor(next / 1440) % 7] + ' ' + hm(next) + ' 오픈' };
  }
  function dayHours(it, day) {
    const segs = [];
    for (const p of it.periods || []) {
      if (!p.open) continue;
      if (!p.close) return '24시간';
      if (p.open.day === day) segs.push(hm(p.open.hour * 60 + (p.open.minute || 0)) + '-' + hm(p.close.hour * 60 + (p.close.minute || 0)));
    }
    return segs.length ? segs.join(', ') : '휴무';
  }

  // ---------- 거리 ----------
  function km(a, b) {
    const R = 6371, r = Math.PI / 180;
    const dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r;
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const fmtD = d => d < 1 ? Math.round(d * 1000) + 'm' : d.toFixed(1) + 'km';
  // 내 위치를 거리 기준으로 쓸지: 위치 사용이 켜져 있고, 타이난·가오슝 근처(60km 안)에 있을 때만
  function tripPos() {
    if (!S.locOn || !myPos) return null;
    return Object.values(D.hotels).some(h => km(myPos, h) < 60) ? myPos : null;
  }
  function refPoint(it) {
    if (tripPos()) return { p: myPos, label: '내 위치' };
    const h = D.hotels[it ? it.city : (S.city === '타이난' ? '타이난' : '가오슝')];
    return { p: h, label: h.name };
  }

  // ---------- 필터 ----------
  function typeMatch(it, t) {
    if (t === 'all') return it.type !== 'hotel';
    if (t === 'sight') return it.type === 'sight' || it.type === 'market';
    if (t === 'cafe') return it.type === 'cafe' || it.type === 'bakery';
    if (t === 'fav') return fav.has(it.id);
    return it.type === t;
  }
  function filtered() {
    const t = twNow(), q = ($('#q').value || '').trim().toLowerCase();
    return ITEMS.filter(it => (S.city === '전체' || it.city === S.city) && typeMatch(it, S.type))
      .filter(it => !q || [it.name, it.zh, it.cuisine, it.cat].join(' ').toLowerCase().includes(q))
      .map(it => ({ it, oi: openInfo(it, t), d: km(refPoint(it).p, it) }))
      .filter(x => S.type === 'fav' || !S.openOnly || x.oi.st === 'open' || x.oi.st === 'closing' || (x.oi.st === 'unknown' && (x.it.type === 'sight' || x.it.type === 'market')))
      .sort((a, b) => a.d - b.d);
  }

  // ---------- 목록 ----------
  function rowHTML(x) {
    const it = x.it;
    const src = it.src === '미쉐린 빕구르망' ? '🏅' : (it.src === '2026 신규' ? '🆕' : (it.src === '대만 대표 체인' ? '🇹🇼' : ''));
    const rate = it.rating ? `⭐${it.rating}` : '';
    return `<div class="item" data-id="${it.id}"><div class="ic">${iconOf(it)}</div>
      <div class="tx"><div class="nm">${esc(it.name)} ${src}${it.infl ? ' <span class="infl">📸</span>' : ''}${it.caution ? ' <span class="cau">⚠</span>' : ''}</div>
      <div class="sub">${esc(it.cuisine || it.cat)} · ${esc(it.city)} ${rate}</div>
      <div><span class="st ${x.oi.st}">${esc(x.oi.txt)}</span>${myRsv[it.id] ? ` <span class="rsvd">🎫 예약 ${esc(myRsv[it.id].w || '')}</span>` : (it.rsv ? ' <span class="rsvok">📅 예약</span>' : '')}</div></div>
      <div class="rt"><button class="heart" data-heart="${it.id}" aria-label="찜">${fav.has(it.id) ? '❤️' : '🤍'}</button><div class="dist">${fmtD(x.d)}</div></div></div>`;
  }
  // 거리 기준 안내: [짧은 문구, 눌렀을 때 설명]
  function refText() {
    if (tripPos()) return ['📍 내 위치에서 거리', '지금 내 위치에서 가게까지 거리예요. 가까운 순으로 보여줘요.'];
    if (!S.locOn) return ['🏨 숙소에서 거리 (위치 꺼짐)', '설정에서 ‘📍 내 위치 사용’이 꺼져 있어서 숙소에서 잰 거리를 보여줘요.'];
    if (myPos) return ['🏨 숙소에서 거리 · 도착하면 내 위치로', '지금은 타이난·가오슝에서 멀리 있어서(한국 등) 숙소에서 잰 거리를 보여줘요. 현지에 도착하면 자동으로 내 위치 기준으로 바뀌어요.'];
    return ['🏨 숙소에서 거리 (위치 허용 안 함)', '위치를 허용하지 않아서 숙소에서 잰 거리를 보여줘요. 설정 → ‘📍 내 위치 사용’에서 허용할 수 있어요.'];
  }
  $('#refline').addEventListener('click', () => toast(refText()[1]));
  let subGroups = null, subSeen = new Set();
  // 고정된 세부 종류 버튼 줄: 같은 종류가 도시별로 나뉘어 있으면 개수를 합치고, 누르면 첫 묶음으로 이동
  let subMap = null, subCur = null;
  function subLabel(k) { return `${SUB[k][0]} ${SUB[k][1]} <b>${subMap.get(k).n}</b> ▾`; }
  function drawSubChips() {
    const btn = $('#subSel');
    if (!SUB_ORDER[S.type] || !subGroups || !subGroups.length) { btn.classList.add('hidden'); subMap = null; return; }
    subMap = new Map();
    for (const [k, n, tag] of subGroups) { const v = subMap.get(k) || { n: 0, tag }; v.n += n; subMap.set(k, v); }
    const ord = SUB_ORDER[S.type].filter(k => subMap.has(k));
    if (!subMap.has(subCur)) subCur = ord[0];
    btn.innerHTML = subLabel(subCur);
    btn.classList.remove('hidden');
    $('#subMenu .subbox').innerHTML = `<div class="subhd">${S.type === 'food' ? '🍜 음식' : '☕ 카페·빵집'} 세부 종류 <small>(누르면 그 종류로 이동)</small></div>`
      + ord.map(k => `<button data-jump="sub-${subMap.get(k).tag}${k}" data-sub="${k}"><span>${SUB[k][0]} ${SUB[k][1]}</span><b>${subMap.get(k).n}곳</b></button>`).join('')
      + '<button class="subclose" data-subclose>닫기</button>';
  }
  $('#subSel').addEventListener('click', () => {
    $$('#subMenu [data-sub]').forEach(b => b.classList.toggle('on', b.dataset.sub === subCur));
    $('#subMenu').classList.remove('hidden');
  });
  $('#subMenu').addEventListener('click', e => {
    if (e.target === $('#subMenu') || e.target.closest('[data-subclose]') || e.target.closest('[data-jump]')) $('#subMenu').classList.add('hidden');
    const j = e.target.closest('[data-sub]'); if (j && subMap) { subCur = j.dataset.sub; $('#subSel').innerHTML = subLabel(subCur); }
  });
  function renderList() {
    subGroups = null; subSeen = new Set();
    const t = twNow();
    const L = filtered();
    const ref = refText();
    $('#refline').innerHTML = `${L.length}곳 · ${ref[0]}` + (S.when !== 'now' ? `<div class="preview">⏱ 미리보기: ${esc(t.label)} 기준 (설정에서 ‘지금’으로 바꾸기)</div>` : '');
    if (!L.length) { subGroups = null; drawSubChips(); $('#list').innerHTML = (S.type === 'fav' ? '<div class="empty">목록 오른쪽의 🤍를 누르면 여기에 모여요.</div>' : '<div class="empty">조건에 맞는 곳이 없어요.<br>‘지금 영업 중만’을 끄고 다시 보세요.</div>'); return; }
    if (!tripPos() && S.city === '전체') {
      // 위치가 없으면 도시별로 나눠서 각 숙소 기준으로 보여줌
      const order = twNow().label === '지금' ? ['가오슝', '타이난'] : (S.when < '2026-11-14T13:00' ? ['타이난', '가오슝'] : ['가오슝', '타이난']);
      $('#list').innerHTML = order.map(c => { const LL = L.filter(x => x.it.city === c); return LL.length ? `<div class="sec">${c === '타이난' ? '🏯' : '🌉'} ${c} · ${esc(D.hotels[c].name)} 기준 (${LL.length}곳)</div>` + groupHTML(LL, c) : ''; }).join('');
      drawSubChips(); return;
    }
    $('#list').innerHTML = groupHTML(L, '');
    drawSubChips();
  }
  // 음식·카페 버튼을 눌렀을 때는 세부 종류별로 묶고(종류 안에서는 가까운 순), 맨 위에 종류 바로가기 줄을 보여줌
  function groupHTML(L, tag) {
    const ord = SUB_ORDER[S.type];
    if (!ord) return L.slice(0, 200).map(rowHTML).join('');
    const G = ord.map(k => [k, L.filter(x => x.it.sub === k)]).filter(g => g[1].length);
    const rest = L.filter(x => !ord.includes(x.it.sub));
    if (!tag || !subSeen.has(tag)) { subSeen.add(tag); subGroups = (subGroups || []).concat(G.map(([k, X]) => [k, X.length, tag])); }
    return G.map(([k, X]) => `<div class="subsec" id="sub-${tag}${k}">${SUB[k][0]} ${SUB[k][1]} <small>(${X.length}곳 · 가까운 순)</small></div>` + X.map(rowHTML).join('')).join('') + rest.map(rowHTML).join('');
  }
  let scrollT = null;
  window.addEventListener('scroll', () => {
    if (scrollT) return;
    scrollT = setTimeout(() => {
      scrollT = null;
      $('#toTop').classList.toggle('hidden', !(activeTab === 'near' && window.scrollY > 500));
      if (!subMap) return;
      const hh = (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hh')) || 160) + 12;
      let cur = null;
      for (const el of $$('.subsec')) { if (el.getBoundingClientRect().top <= hh) cur = el.id.replace(/^sub-(타이난|가오슝)?/, ''); else break; }
      cur = cur || SUB_ORDER[S.type].find(k => subMap.has(k));
      if (cur !== subCur && subMap.has(cur)) { subCur = cur; $('#subSel').innerHTML = subLabel(cur); }
    }, 120);
  }, { passive: true });
  $('#toTop').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  document.addEventListener('click', e => {
    const j = e.target.closest('[data-jump]'); if (!j) return;
    const el = document.getElementById(j.dataset.jump); if (!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hh')) || 160) - 6, behavior: 'smooth' });
  });
  // ---------- 상세 카드 ----------
  const TRIP_DAYS = { '타이난': [['11/13(금)', 5], ['11/14(토)', 6]], '가오슝': [['11/14(토)', 6], ['11/15(일)', 0], ['11/16(월)', 1]] };
  function dirUrl(it, fromHotel) {
    let u = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(it.zh) + (it.pid ? '&destination_place_id=' + it.pid : '');
    if (fromHotel) { const h = D.hotels[it.city]; u += '&origin=' + encodeURIComponent(h.zh); }
    return u;
  }
  function openCard(id) {
    const it = BY_ID[id]; if (!it) return;
    const t = twNow(), oi = openInfo(it, t), ref = refPoint(it), d = km(ref.p, it);
    const srcCls = it.src === '미쉐린 빕구르망' ? 'mic' : (it.src ? 'hi' : 'cf');
    const days = (TRIP_DAYS[it.city] || []).map(([lab, dy]) => { const h = dayHours(it, dy); return `<td class="${h === '휴무' ? 'off' : 'on'}"><b>${lab}</b><br>${esc(it.periods.length ? h : '정보 없음')}</td>`; }).join('');
    const menu = (it.menu || []).filter(m => m.i).map(m => `<tr><td>${esc(m.i)}</td><td>${esc(m.p)}</td></tr>`).join('');
    const walk = d <= 1.2 ? `도보 약 ${Math.round(d * 1.35 * 1000 / 75)}분` : `택시·우버 약 ${Math.round(d * 1.3 / (d < 4 ? 22 : d < 10 ? 28 : 40) * 60 + 3)}분`;
    $('#sheetIn').innerHTML = `<button class="close" data-x>✕</button>
      <h3>${iconOf(it)} ${esc(it.name)}</h3><div class="zh">${esc(it.zh)}</div>
      <div class="badges"><span class="badge">${esc(it.cat)}</span>${it.cuisine ? `<span class="badge">${esc(it.cuisine)}</span>` : ''}${it.src ? `<span class="badge ${srcCls}">${SRC_ICON[it.src] || ''} ${esc(it.src)}</span>` : ''}${it.b19 ? `<span class="badge cf">📝 먹을거리 게시판 추천 ${it.b19}건</span>` : ''}</div>
      <div><span class="st ${oi.st}">${esc(oi.txt)}</span> <small>(${esc(t.label)} 기준)</small></div>
      ${it.rating ? `<div class="kv">⭐ 구글 평점 <b style="display:inline">${it.rating}</b> · 리뷰 ${Number(it.reviews || 0).toLocaleString()}개</div>` : ''}
      <div class="btnrow"><a class="btn" href="${it.map}" target="_blank" rel="noopener">📍 구글맵 열기<br><small>리뷰·사진</small></a>
        <a class="btn green" href="${dirUrl(it, false)}" target="_blank" rel="noopener">🧭 길찾기<br><small>현재 위치에서</small></a></div>
      <div class="btnrow"><button class="btn dark" data-fav>${fav.has(it.id) ? '❤️ 찜 해제' : '🤍 찜하기'}</button>
        <button class="btn gray" data-taxi>🚕 주소 크게 보기</button></div>
      ${rsvHTML(it)}
      ${it.infl ? `<div class="inflBox">📸 <b>인플루언서 추천</b><br>${esc(it.infl)}</div>` : ''}
      ${it.caution ? `<div class="cauBox">⚠ <b>카페 후기 호불호</b><br>${esc(it.caution)}</div>` : ''}
      ${it.review ? `<div class="kv"><b>💬 후기 요약</b>${esc(it.review)}</div>` : ''}
      ${menu ? `<table class="menu"><tr><th>대표 메뉴·상품</th><th>TWD</th></tr>${menu}</table>` : ''}
      ${days ? `<b style="font-size:12.5px;color:#555">🗓 여행 날짜 영업시간 (구글맵)</b><table class="days"><tr>${days}</tr></table>` : ''}
      <div class="kv"><b>🚕 주소</b><div class="addr">${esc(it.addr)}</div></div>
      <div class="kv"><b>🚶 거리</b>${esc(ref.label)}에서 ${fmtD(d)} · ${walk}${it.station ? '<br>🚇 ' + esc(it.station) : ''}
        <br><a href="${dirUrl(it, true)}" target="_blank" rel="noopener">🏨 숙소에서 길찾기</a></div>
      ${it.closed ? `<div class="kv"><b>🚫 정기휴무</b>${esc(it.closed)}</div>` : ''}
      ${it.price ? `<div class="kv"><b>💰 가격대</b>${esc(it.price)}</div>` : ''}
      ${it.tips ? `<div class="kv"><b>💡 팁</b>${esc(it.tips)}</div>` : ''}
      <p class="hint">대만 가게는 부정기 휴무가 잦아요. 가기 전 [구글맵 열기]로 한 번 더 확인하세요.</p>`;
    $('#sheet').classList.remove('hidden');
    $('#sheet').dataset.id = id;
    history.pushState({ card: id }, '', '#' + id);
  }
  function rsvHTML(it) {
    const m = myRsv[it.id];
    if (!it.rsv && !m) return '';
    let h = '<div class="rsvBox">';
    if (m) h += `<div class="rsvMine">🎫 <b>내 예약</b> ${esc(m.w || '')}</div>
      <div class="btnrow"><a class="btn purple" href="${esc(m.u || (it.rsv && it.rsv.u) || it.map)}" target="_blank" rel="noopener">🎫 내 예약 보기<br><small>${m.u ? '저장한 확인 링크' : '예약 페이지'}</small></a>
        <button class="btn gray" data-rsvedit>✏️ 수정·삭제</button></div>`;
    else h += `<div class="btnrow"><a class="btn purple" href="${esc(it.rsv.u)}" target="_blank" rel="noopener">📅 온라인 예약<br><small>${esc(it.rsv.n)}</small></a>
        <button class="btn gray" data-rsvedit>🎫 예약했어요<br><small>확인 링크 저장</small></button></div>`;
    return h + '</div>';
  }
  function rsvForm(id) {
    const m = myRsv[id] || {};
    $('#taxi').innerHTML = `<div class="rsvForm" onclick="event.stopPropagation()">
      <h3>🎫 내 예약 저장</h3>
      <p class="hint">예약 후 문자·메일·앱에서 받은 <b>예약 확인 링크</b>를 붙여넣으세요. (없으면 비워 둬도 돼요)</p>
      <input id="rsvU" type="url" placeholder="https://..." value="${esc(m.u || '')}">
      <p class="hint">예약 날짜·시간</p>
      <input id="rsvW" type="text" placeholder="예: 11/15 18:30 · 3명" value="${esc(m.w || '')}">
      <div class="btnrow"><button class="btn green" data-rsvsave>저장</button>${myRsv[id] ? '<button class="btn gray" data-rsvdel>예약 삭제</button>' : ''}<button class="btn gray" data-rsvx>취소</button></div>
    </div>`;
    $('#taxi').classList.remove('hidden');
    $('#taxi').querySelector('[data-rsvsave]').onclick = () => {
      const u = $('#rsvU').value.trim(), w = $('#rsvW').value.trim();
      if (u && !/^https?:\/\//i.test(u)) return toast('링크는 https:// 로 시작해야 해요');
      myRsv[id] = { u, w }; LS.set('rsv', myRsv); fav.add(id); LS.set('fav', [...fav]);
      $('#taxi').classList.add('hidden'); openCard(id); history.back(); refresh(); toast('🎫 예약을 저장했어요 (❤️ 찜에도 넣었어요)');
    };
    const del = $('#taxi').querySelector('[data-rsvdel]');
    if (del) del.onclick = () => { delete myRsv[id]; LS.set('rsv', myRsv); $('#taxi').classList.add('hidden'); openCard(id); history.back(); refresh(); toast('예약 기록을 지웠어요'); };
    $('#taxi').querySelector('[data-rsvx]').onclick = () => $('#taxi').classList.add('hidden');
  }
  function closeCard() { $('#sheet').classList.add('hidden'); }
  $('#sheet').addEventListener('click', e => {
    const id = $('#sheet').dataset.id;
    if (e.target === $('#sheet') || e.target.closest('[data-x]')) { history.back(); return; }
    if (e.target.closest('[data-fav]')) { fav.has(id) ? fav.delete(id) : fav.add(id); LS.set('fav', [...fav]); openCard(id); history.back(); refresh(); }
    if (e.target.closest('[data-rsvedit]')) { rsvForm(id); return; }
    if (e.target.closest('[data-taxi]')) { const it = BY_ID[id]; $('#taxi').innerHTML = `<div class="nm">${esc(it.zh)}</div><div class="big">${esc(it.addr)}</div><p>請帶我去這裡，謝謝！<br>(여기로 가 주세요)</p><button class="btn gray" style="max-width:240px">닫기</button>`; $('#taxi').classList.remove('hidden'); }
  });
  $('#taxi').addEventListener('click', e => { if (!e.target.closest('.rsvForm')) $('#taxi').classList.add('hidden'); });
  window.addEventListener('popstate', () => { if (!$('#sheet').classList.contains('hidden')) closeCard(); });
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (BY_ID[h] && $('#sheet').classList.contains('hidden')) openCard(h); });
  document.addEventListener('click', e => {
    const hb = e.target.closest('[data-heart]');
    if (hb) {
      e.stopPropagation();
      const id = hb.dataset.heart;
      fav.has(id) ? fav.delete(id) : fav.add(id); LS.set('fav', [...fav]);
      hb.textContent = fav.has(id) ? '❤️' : '🤍';
      toast(fav.has(id) ? '❤️ 찜했어요 (위의 ‘❤️ 찜’에서 모아 보기)' : '찜을 해제했어요');
      if (S.type === 'fav') renderList();
      return;
    }
    const r = e.target.closest('.item'); if (r) openCard(r.dataset.id);
  });

  // ---------- 지도 ----------
  // 기본은 무료 지도(OpenStreetMap, 사용량 0). [구글 지도로 보기]를 누를 때만 구글 지도를 불러옴(앱을 켠 동안 1회만)
  const POI_OFF = [{ featureType: 'poi.business', stylers: [{ visibility: 'off' }] }, { featureType: 'poi.attraction', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] }];
  const E = { osm: { map: null, items: [], me: null }, google: { map: null, items: [], me: null, info: null } };
  let cur = 'osm', gLoading = false;
  const popupHTML = (it, oi) => `<div style="min-width:170px"><b>${esc(it.name)}</b><br>${esc(it.zh)}<br><span class="st ${oi.st}">${esc(oi.txt)}</span><br><a href="#" data-open="${it.id}">자세히 보기 ›</a></div>`;
  function centerOf() { return S.city === '타이난' ? D.hotels['타이난'] : D.hotels['가오슝']; }
  // 구글 지도 키: 이 휴대폰에만 저장 (공개 소스에는 없음)
  const mapsKey = () => LS.get('mapskey', '') || window.MAPS_KEY || '';
  function keyTail() { const k = mapsKey(); return k ? '••••' + k.slice(-4) : ''; }
  function askKey() {
    return new Promise(done => {
      $('#keyAsk').innerHTML = `<div class="locBox">
        <h3>🔑 구글 지도 키 입력</h3>
        <p>한국어 구글 지도를 쓰려면 키가 필요해요. <b>받은 키를 붙여넣어 주세요.</b><br><small>키는 이 휴대폰에만 저장되고 다른 곳에 보내지 않아요. 키가 없어도 무료 지도와 다른 기능은 모두 쓸 수 있어요.</small></p>
        <input id="keyIn" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="AIza로 시작하는 키">
        <p class="warn hidden" id="keyErr">키 모양이 맞지 않아요. AIza로 시작하는 39자예요.</p>
        <div class="btnrow"><button class="btn green" data-keysave>저장</button><button class="btn gray" data-keyx>취소</button></div>
      </div>`;
      $('#keyAsk').classList.remove('hidden');
      setTimeout(() => $('#keyIn').focus(), 50);
      $('#keyAsk').querySelector('[data-keysave]').onclick = () => {
        const k = $('#keyIn').value.trim();
        if (!/^AIza[0-9A-Za-z_\-]{35}$/.test(k)) { $('#keyErr').classList.remove('hidden'); return; }
        LS.set('mapskey', k); $('#keyAsk').classList.add('hidden'); keyState(); done(true);
      };
      $('#keyAsk').querySelector('[data-keyx]').onclick = () => { $('#keyAsk').classList.add('hidden'); done(false); };
    });
  }
  function keyState() {
    const el = $('#keyState'); if (!el) return;
    el.innerHTML = mapsKey() ? `구글 지도 키: <b>입력됨</b> (${keyTail()}) <button class="mini" data-keychg>변경</button> <button class="mini" data-keydel>지우기</button>`
      : `구글 지도 키: <b>없음</b> <button class="mini" data-keychg>키 입력</button>`;
  }
  document.addEventListener('click', async e => {
    if (e.target.closest('[data-keychg]')) {
      const had = !!(window.google && google.maps);
      if (await askKey()) toast(had ? '새 키는 앱을 다시 열면 적용돼요.' : '키를 저장했어요. 지도 탭에서 [구글 지도로 보기]를 눌러 보세요.');
    }
    if (e.target.closest('[data-keydel]')) { LS.set('mapskey', ''); if (cur === 'google') useMap('osm'); keyState(); toast('이 휴대폰에서 키를 지웠어요.'); }
  });
  function loadGoogle() {
    return new Promise((ok, fail) => {
      if (!mapsKey()) return fail('no key');
      if (window.google && google.maps) return ok();
      window.__gmReady = ok;
      window.gm_authFailure = () => { fail('auth'); toast('키가 맞지 않거나 이 사이트에서 쓸 수 없는 키예요. 설정 → 지도에서 키를 다시 입력해 주세요. 지금은 무료 지도로 보여드려요.'); useMap('osm'); };
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(mapsKey())}&language=ko&region=TW&callback=__gmReady&loading=async`;
      s.async = true; s.onerror = () => fail('load');
      document.head.appendChild(s);
      setTimeout(() => fail('timeout'), 12000);
    });
  }
  function initOsm() {
    if (E.osm.map) return;
    const c = centerOf();
    const m = L.map('map', { zoomControl: false }).setView([c.lat, c.lng], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
    L.control.zoom({ position: 'topright' }).addTo(m);
    for (const h of Object.values(D.hotels)) L.marker([h.lat, h.lng], { icon: L.divIcon({ className: '', html: '<div class="mk" style="background:#f1c40f">★</div>', iconSize: [26, 26] }) }).addTo(m).bindPopup('🏨 ' + h.name);
    E.osm.map = m;
  }
  function initGoogle() {
    if (E.google.map) return;
    const v = E.osm.map ? E.osm.map.getCenter() : centerOf();
    const z = E.osm.map ? E.osm.map.getZoom() : 14;
    const m = new google.maps.Map($('#gmap'), { center: { lat: v.lat, lng: v.lng }, zoom: z, disableDefaultUI: true, zoomControl: true,
      zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_CENTER }, gestureHandling: 'greedy',
      clickableIcons: !!S.poiOn, styles: S.poiOn ? [] : POI_OFF });
    E.google.info = new google.maps.InfoWindow();
    for (const h of Object.values(D.hotels)) {
      const mk = new google.maps.Marker({ position: { lat: h.lat, lng: h.lng }, map: m, zIndex: 999, label: { text: '★', color: '#7a5b00', fontSize: '15px' },
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 14, fillColor: '#f1c40f', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 } });
      mk.addListener('click', () => { E.google.info.setContent('🏨 ' + esc(h.name)); E.google.info.open({ map: m, anchor: mk }); });
    }
    E.google.map = m;
  }
  function viewOf(k) {
    const m = E[k].map; if (!m) return null;
    const c = m.getCenter(); return { lat: typeof c.lat === 'function' ? c.lat() : c.lat, lng: typeof c.lng === 'function' ? c.lng() : c.lng, z: m.getZoom() };
  }
  async function useMap(k) {
    if (k === 'google') {
      if (!mapsKey() && !(await askKey())) { toast('키가 없으면 무료 지도로 보여드려요.'); k = 'osm'; }
      if (k === 'osm') { }
      else if (!E.google.map) {
        if (gLoading) return;
        gLoading = true; $('#mapSwitch').textContent = '구글 지도 불러오는 중…';
        try { await loadGoogle(); initGoogle(); } catch (e) { k = 'osm'; }
        gLoading = false;
      }
    }
    const prev = viewOf(cur);
    cur = k;
    S.mapType = k; saveS();
    $('#map').classList.toggle('hidden', k !== 'osm');
    $('#gmap').classList.toggle('hidden', k !== 'google');
    if (k === 'osm') initOsm();
    if (prev) setView(prev.lat, prev.lng, prev.z);
    $('#mapSwitch').textContent = k === 'osm' ? '🇰🇷 구글 지도로 보기' : '🗺 무료 지도로';
    $$('#mapSeg button').forEach(b => b.classList.toggle('on', b.dataset.m === k));
    renderMap();
  }
  function clearMarkers() {
    for (const k of ['osm', 'google']) { for (const m of E[k].items) k === 'google' ? m.setMap(null) : m.remove(); E[k].items = []; }
  }
  function renderMap() {
    if (!E[cur].map) { if (cur === 'osm') initOsm(); else return; }
    resizeMap();
    clearMarkers();
    const m = E[cur].map;
    for (const x of filtered()) {
      const it = x.it, on = x.oi.st === 'open' || x.oi.st === 'closing';
      if (cur === 'google') {
        const mk = new google.maps.Marker({ position: { lat: it.lat, lng: it.lng }, map: m, title: it.name, opacity: on ? 1 : 0.55,
          label: { text: iconOf(it), fontSize: '13px' },
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: 13, fillColor: COLOR[it.type], fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 } });
        mk.addListener('click', () => { E.google.info.setContent(popupHTML(it, x.oi)); E.google.info.open({ map: m, anchor: mk }); });
        E.google.items.push(mk);
      } else {
        const mk = L.marker([it.lat, it.lng], { icon: L.divIcon({ className: '', html: `<div class="mk" style="background:${COLOR[it.type]};opacity:${on ? 1 : .55}">${iconOf(it)}</div>`, iconSize: [26, 26] }) });
        mk.bindPopup(popupHTML(it, x.oi)); mk.addTo(m); E.osm.items.push(mk);
      }
    }
    drawMe();
  }
  function drawMe() {
    if (!myPos) return;
    const g = E.google, o = E.osm;
    if (g.map) {
      if (!g.me) g.me = new google.maps.Marker({ map: g.map, zIndex: 1000, position: myPos, icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#1a73e8', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 } });
      else g.me.setPosition(myPos);
    }
    if (o.map) {
      if (!o.me) o.me = L.marker([myPos.lat, myPos.lng], { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [18, 18] }), zIndexOffset: 2000 }).addTo(o.map);
      else o.me.setLatLng([myPos.lat, myPos.lng]);
    }
  }
  function setView(lat, lng, z) {
    const m = E[cur].map; if (!m) return;
    cur === 'google' ? (m.setCenter({ lat, lng }), m.setZoom(z)) : m.setView([lat, lng], z);
  }
  function resizeMap() { if (E.osm.map && cur === 'osm') setTimeout(() => E.osm.map.invalidateSize(), 50); }
  document.addEventListener('click', e => { const a = e.target.closest('[data-open]'); if (a) { e.preventDefault(); openCard(a.dataset.open); } });
  // 내 위치 버튼: 위치를 새로 받아온 뒤 그 자리로 이동 (처음 누를 때도 바로 이동되게)
  let centerNext = false;
  $('#locBtn').addEventListener('click', () => { centerNext = true; if (myPos) setView(myPos.lat, myPos.lng, 16); getPos(true); });
  $('#mapSwitch').addEventListener('click', () => useMap(cur === 'osm' ? 'google' : 'osm'));
  function centerCity() {
    const m = E[cur].map; if (!m) return;
    if (S.city !== '전체') { const h = D.hotels[S.city]; setView(h.lat, h.lng, 14); return; }
    const pts = filtered().map(x => [x.it.lat, x.it.lng]);
    if (!pts.length) return;
    if (cur === 'google') { const b = new google.maps.LatLngBounds(); pts.forEach(p => b.extend({ lat: p[0], lng: p[1] })); m.fitBounds(b, 30); }
    else m.fitBounds(pts, { padding: [30, 30] });
  }

  // ---------- 위치 ----------
  function onPos(p) {
    myPos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
    drawMe();
    checkNearby();
    if (activeTab === 'near' || activeTab === 'map') renderList();
    if (activeTab === 'map') drawMe();
    if (centerNext) { centerNext = false; setView(myPos.lat, myPos.lng, 16); }
  }
  function getPos(ask) {
    if (!navigator.geolocation) return;
    if (!S.locOn) { if (ask) toast('설정에서 ‘📍 내 위치 사용’을 켜 주세요.'); return; }
    navigator.geolocation.getCurrentPosition(onPos, err => { if (ask) { if (err && err.code === 1) showLocAsk('denied'); else toast('위치를 가져오지 못했어요. 휴대폰 위치(GPS)가 켜져 있는지 확인해 주세요.'); } updatePerm(); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: ask ? 0 : 20000 });
  }

  // ---------- 근처 알림 ----------
  function today() { const n = new Date(Date.now() + 8 * 3600e3); return n.toISOString().slice(0, 10); }
  function alertType(it) { return it.type === 'bakery' ? 'cafe' : (it.type === 'market' ? 'sight' : it.type); }
  async function notify(title, body, id) {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg) { await reg.showNotification(title, { body, tag: id, data: { id }, icon: 'icon-192.png', vibrate: [200, 100, 200] }); }
        else new Notification(title, { body, tag: id, icon: 'icon-192.png' });
      } catch (e) { new Notification(title, { body }); }
    }
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    toast(`🔔 ${title}<br>${body}`, id);
  }
  function checkNearby() {
    if (!S.alertOn || !myPos || S.when !== 'now') return;
    const t = twNow(), day = today();
    if (alerted._day !== day) alerted = { _day: day };
    for (const it of ITEMS) {
      if (it.type === 'hotel' || !S.atypes.includes(alertType(it))) continue;
      if (alerted[it.id]) continue;
      const d = km(myPos, it) * 1000;
      if (d > S.radius) continue;
      const oi = openInfo(it, t);
      const ok = oi.st === 'open' || oi.st === 'closing' || (oi.st === 'unknown' && (it.type === 'sight' || it.type === 'market'));
      if (!ok) continue;
      alerted[it.id] = Date.now();
      notify(`${iconOf(it)} 근처 ${Math.round(d)}m: ${it.name}`, `${it.cuisine || it.cat} · ${oi.txt}${it.rating ? ' · ⭐' + it.rating : ''}`, it.id);
    }
    LS.set('alerted', alerted);
  }
  // 위치 추적: ‘내 위치 사용’이 켜져 있으면 계속 따라감 (근처 알림과 별개)
  function startWatch() {
    if (!navigator.geolocation) { toast('이 브라우저는 위치 기능을 지원하지 않아요.'); return; }
    if (watchId == null) watchId = navigator.geolocation.watchPosition(p => { onPos(p); updatePerm(); }, err => { if (err && err.code === 1) stopWatch(); }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
    updatePerm();
  }
  function stopWatch() { if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; } updatePerm(); }
  async function askNotify() {
    if ('Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch (e) { } }
    updatePerm();
  }
  let geoPerm = 'unknown';
  async function readGeoPerm() {
    try {
      const st = await navigator.permissions.query({ name: 'geolocation' }); geoPerm = st.state;
      st.onchange = () => { geoPerm = st.state; updatePerm(); if (geoPerm === 'granted') { hideLocAsk(); if (S.locOn) startWatch(); } };
    } catch (e) { geoPerm = 'unknown'; }
    return geoPerm;
  }
  function updatePerm() {
    const n = 'Notification' in window ? Notification.permission : '지원 안 함';
    const nk = { granted: '허용됨', denied: '차단됨 (브라우저 설정에서 허용 필요)', default: '아직 묻지 않음' }[n] || n;
    const gk = { granted: '허용됨', denied: '차단됨', prompt: '아직 묻지 않음', unknown: myPos ? '허용됨' : '확인 중' }[geoPerm] || geoPerm;
    const ls = $('#locState');
    if (ls) ls.innerHTML = `위치 권한: <b>${gk}</b> · 위치 추적: <b>${watchId != null ? '작동 중' : '꺼짐'}</b>`
      + (myPos && S.locOn && !tripPos() ? '<br>지금은 타이난·가오슝 밖이라 거리는 숙소 기준으로 보여줘요.' : '')
      + (geoPerm === 'denied' ? '<br><a href="#" id="locHelp">위치 허용 방법 보기</a>' : '');
    $('#permState').innerHTML = `알림 권한: <b>${nk}</b>` + (!S.locOn ? '<br>⚠ 근처 알림은 ‘📍 내 위치 사용’이 켜져 있어야 작동해요.' : '') + (S.when !== 'now' ? '<br>⚠ 기준 시각이 ‘지금’이 아니면 알림이 멈춰요.' : '');
  }
  // 접속 시 위치 허용 안내 (아직 허용 전이거나 차단 상태일 때)
  let locAskDone = false;   // 안내창에서 이미 버튼을 눌렀으면 다시 띄우지 않음
  function showLocAsk(state) {
    const denied = state === 'denied';
    if (!denied && (locAskDone || myPos || geoPerm === 'granted')) return;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const how = ios ? '아이폰: <b>설정 → 개인정보 보호 및 보안 → 위치 서비스</b>를 켜고, 사용하는 브라우저(Safari 웹 사이트 등)를 <b>「앱을 사용하는 동안」</b>으로 바꾼 뒤 이 화면을 새로고침하세요.'
      : '안드로이드 크롬: 주소창 왼쪽 <b>아이콘(⚙ 또는 자물쇠) → 권한 → 위치 → 허용</b>을 누른 뒤 새로고침하세요. 휴대폰 위치(GPS)도 켜져 있어야 해요.';
    $('#locAsk').innerHTML = `<div class="locBox">
      <h3>📍 내 위치를 사용할까요?</h3>
      <p>허용하면 가게까지 거리와 가까운 순서를 <b>지금 내 위치 기준</b>으로 보여줘요. 허용하지 않으면 <b>숙소 기준</b>으로 보여줘요.<br><small>위치는 이 휴대폰 안에서만 쓰이고 어디에도 보내지 않아요.</small></p>
      ${denied ? `<p class="warn">⚠ 지금 위치 권한이 <b>차단</b>되어 있어요.<br>${how}</p>` : ''}
      <div class="btnrow">${denied ? '' : '<button class="btn green" data-locyes>📍 위치 허용</button>'}<button class="btn gray" data-locno>${denied ? '닫기' : '나중에'}</button></div>
    </div>`;
    $('#locAsk').classList.remove('hidden');
  }
  function hideLocAsk() { $('#locAsk').classList.add('hidden'); }
  $('#locAsk').addEventListener('click', e => {
    if (e.target.closest('[data-locyes]')) { locAskDone = true; hideLocAsk(); S.locOn = true; saveS(); $('#locOn').checked = true; startWatch(); getPos(true); }
    else if (e.target.closest('[data-locno]') || e.target === $('#locAsk')) { locAskDone = true; hideLocAsk(); sessionStorage.setItem('locAskShown', '1'); }
  });
  document.addEventListener('click', e => { if (e.target.closest('#locHelp')) { e.preventDefault(); showLocAsk('denied'); } });
  let wakeLock = null;
  async function setWake(on) {
    try {
      if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
      else if (wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) { }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.wakeOn) setWake(true); });

  // ---------- 토스트 ----------
  let toastT = null;
  function toast(html, id) {
    const el = $('#toast'); el.innerHTML = html; el.classList.remove('hidden'); el.onclick = () => { el.classList.add('hidden'); if (id) openCard(id); };
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.add('hidden'), 6000);
  }

  // ---------- 탭·컨트롤 ----------
  let activeTab = 'near';
  function showTab(t) {
    activeTab = t;
    document.body.dataset.tab = t;
    $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    $$('.tab').forEach(s => s.classList.toggle('on', s.id === 'tab-' + t));
    if (t === 'near') renderList();
    if (t === 'map') { renderMap(); }
    if (t === 'near' || t === 'map') getPos(false);
    if (t === 'info') loadInfo();
    if (t === 'set') updatePerm();
    window.scrollTo(0, 0);
  }
  function refresh() { if (activeTab === 'near') renderList(); if (activeTab === 'map') renderMap(); }
  $$('#tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $$('#citySeg button').forEach(b => { b.classList.toggle('on', b.dataset.city === S.city); b.addEventListener('click', () => { S.city = b.dataset.city; saveS(); $$('#citySeg button').forEach(x => x.classList.toggle('on', x === b)); refresh(); centerCity(); }); });
  $$('#typeChips button').forEach(b => { b.classList.toggle('on', b.dataset.t === S.type); b.addEventListener('click', () => { S.type = b.dataset.t; saveS(); $$('#typeChips button').forEach(x => x.classList.toggle('on', x === b)); subCur = null; window.scrollTo(0, 0); refresh(); }); });
  $('#openOnly').checked = S.openOnly;
  $('#openOnly').addEventListener('change', e => { S.openOnly = e.target.checked; saveS(); refresh(); });
  $('#when').innerHTML = PRESETS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  $('#when').value = S.when;
  $('#when').addEventListener('change', e => { S.when = e.target.value; saveS(); refresh(); updatePerm(); tick(); });
  let qT = null; $('#q').addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(refresh, 200); });
  $('#qBtn').addEventListener('click', () => { const q = $('#q'); q.classList.toggle('hidden'); if (!q.classList.contains('hidden')) q.focus(); else { q.value = ''; refresh(); } });

  // 설정
  $('#alertOn').checked = S.alertOn;
  $('#alertOn').addEventListener('change', e => {
    S.alertOn = e.target.checked;
    if (S.alertOn && !S.locOn) { S.locOn = true; $('#locOn').checked = true; startWatch(); toast('근처 알림은 내 위치가 필요해서 ‘📍 내 위치 사용’도 켰어요.'); }
    saveS(); if (S.alertOn) askNotify(); updatePerm();
  });
  keyState();
  $('#locOn').checked = S.locOn;
  $('#locOn').addEventListener('change', e => {
    S.locOn = e.target.checked;
    if (S.locOn) { startWatch(); getPos(true); }
    else { stopWatch(); if (S.alertOn) { S.alertOn = false; $('#alertOn').checked = false; toast('위치를 끄면 근처 알림도 꺼져요.'); } }
    saveS(); refresh(); updatePerm();
  });
  $('#radius').value = String(S.radius);
  $('#radiusTxt').textContent = S.radius + 'm';
  $('#radius').addEventListener('change', e => { S.radius = Number(e.target.value); $('#radiusTxt').textContent = S.radius + 'm'; saveS(); });
  $$('.atype').forEach(c => { c.checked = S.atypes.includes(c.value); c.addEventListener('change', () => { S.atypes = $$('.atype').filter(x => x.checked).map(x => x.value); saveS(); }); });
  $('#wakeOn').checked = S.wakeOn;
  $('#wakeOn').addEventListener('change', e => { S.wakeOn = e.target.checked; saveS(); setWake(S.wakeOn); });
  $('#testAlert').addEventListener('click', async () => {
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    const it = ITEMS.find(x => x.type === 'food');
    notify('🔔 테스트 알림', `알림이 이렇게 와요 · 예: ${it.name}`, it.id); updatePerm();
  });
  $('#resetAlerted').addEventListener('click', () => { alerted = { _day: today() }; LS.set('alerted', alerted); toast('오늘 알림 기록을 지웠어요.'); });
  $('#built').textContent = D.built;

  // 글씨 크기: 지도는 그대로 두고 목록·카드·정보·설정 화면만 확대
  function applyZoom() {
    ['#top', '#tab-near', '#tab-talk', '#tab-info', '#tab-set', '#sheetIn', '#toast'].forEach(s => { const el = $(s); if (el) el.style.zoom = S.zoom; });
    $$('#fontSeg button').forEach(b => b.classList.toggle('on', Number(b.dataset.z) === Number(S.zoom)));
  }
  // 지도 종류·주변 가게 표시: 바꾸면 새로 불러오기
  $$('#mapSeg button').forEach(b => { b.classList.toggle('on', b.dataset.m === 'osm'); b.addEventListener('click', () => { if (cur === b.dataset.m) return; showTab('map'); useMap(b.dataset.m); }); });
  $('#poiOn').checked = S.poiOn;
  $('#poiOn').addEventListener('change', e => { S.poiOn = e.target.checked; saveS(); if (E.google.map) E.google.map.setOptions({ clickableIcons: S.poiOn, styles: S.poiOn ? [] : POI_OFF }); });
  $$('#fontSeg button').forEach(b => b.addEventListener('click', () => { S.zoom = Number(b.dataset.z); saveS(); applyZoom(); setTimeout(() => window.dispatchEvent(new Event('resize')), 50); }));
  applyZoom();

  // 정보 탭
  let infoLoaded = false;
  function loadInfo() {
    if (infoLoaded) return;
    fetch('info.html?v=20261022b').then(r => r.text()).then(h => { $('#info').innerHTML = h; infoLoaded = true; })
      .catch(() => { $('#info').innerHTML = '정보를 불러오지 못했어요. 인터넷 연결 후 다시 열어 주세요.'; });
  }

  // 회화 카드: 문장을 누르면 큰 글씨, 직접 쓴 한국어는 파파고·구글 번역으로 연결
  function showBig(zh, ko, pron) {
    $('#taxi').innerHTML = `<div class="big">${esc(zh)}</div>${pron ? `<p class="pron">${esc(pron)}</p>` : ''}${ko ? `<p class="kor">${esc(ko)}</p>` : ''}<button class="btn gray" style="max-width:240px">닫기</button>`;
    $('#taxi').classList.remove('hidden');
  }
  $('#phraseList').innerHTML = Object.entries(window.PHRASES || {}).map(([cat, L]) =>
    `<div class="pcat">${esc(cat)}</div>` + L.map(([ko, zh, pr]) => `<button class="phr" data-zh="${esc(zh)}" data-ko="${esc(ko)}" data-pr="${esc(pr)}"><span class="pk">${esc(ko)}</span><span class="pz">${esc(zh)}</span></button>`).join('')).join('');
  $('#phraseList').addEventListener('click', e => { const b = e.target.closest('.phr'); if (b) showBig(b.dataset.zh, b.dataset.ko, b.dataset.pr); });
  $('#papagoBtn').addEventListener('click', () => { const t = $('#koText').value.trim(); if (!t) return toast('번역할 한국어를 먼저 써 주세요.'); window.open('https://papago.naver.com/?sk=ko&tk=zh-TW&st=' + encodeURIComponent(t), '_blank'); });
  $('#bigBtn').addEventListener('click', () => { const z = $('#zhText').value.trim(); if (!z) return toast('번역된 중국어를 붙여넣어 주세요.'); showBig(z, $('#koText').value.trim(), ''); });

  // 시계
  function tick() { const t = twNow(); $('#clock').textContent = (S.when === 'now' ? '대만 ' : '기준 ') + DAYK[t.day] + ' ' + hm(t.min); }
  setInterval(() => { tick(); if (document.visibilityState === 'visible' && (activeTab === 'near' || activeTab === 'map')) getPos(false); if (S.when === 'now' && activeTab === 'near') renderList(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') getPos(false); });

  // 서비스워커: 오프라인 사용 + 알림 클릭 처리
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // 새 버전이 올라오면 화면을 한 번 자동 새로고침 (예전 화면이 계속 보이는 문제 방지)
    const hadSW = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadSW && !window.__reloaded) { window.__reloaded = 1; location.reload(); } });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => { r.update(); document.addEventListener('visibilitychange', () => { if (!document.hidden) r.update(); }); }).catch(() => { });
    navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.open) openCard(e.data.open); });
  }

  // 상단(헤더) 높이를 CSS 변수로: 글씨 크기·화면 회전에 따라 겹치지 않게
  function setHH() { const h = $('#top').getBoundingClientRect().height; document.documentElement.style.setProperty('--hh', Math.round(h) + 'px'); resizeMap(); }
  window.addEventListener('resize', setHH);
  new ResizeObserver(setHH).observe($('#top'));

  // 시작
  tick();
  showTab('near');
  // 시작: 위치 사용이 켜져 있으면 권한 상태를 보고 바로 추적하거나 허용 안내를 띄움
  (async () => {
    if (!S.locOn || !navigator.geolocation) { updatePerm(); return; }
    const st = await readGeoPerm();
    if (st === 'granted') startWatch();
    else if (!sessionStorage.getItem('locAskShown')) showLocAsk(st === 'denied' ? 'denied' : 'prompt');
    updatePerm();
  })();
  if (S.wakeOn) setWake(true);
  const h = location.hash.slice(1); if (BY_ID[h]) openCard(h);
  const qt = new URLSearchParams(location.search).get('tab'); if (qt) showTab(qt);
})();
