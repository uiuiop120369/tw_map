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
  const SRC_ICON = { '미쉐린 빕구르망': '🏅', '구글 고평점': '⭐', '카페 추천': '📝', '펑리수 유명점': '🍍' };

  // ---------- 저장 ----------
  const LS = {
    get(k, d) { try { return JSON.parse(localStorage.getItem('tw_' + k)) ?? d; } catch (e) { return d; } },
    set(k, v) { localStorage.setItem('tw_' + k, JSON.stringify(v)); }
  };
  const S = Object.assign({ city: '전체', type: 'all', openOnly: true, when: 'now', alertOn: false, radius: 300,
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
  function refPoint(it) {
    if (myPos) return { p: myPos, label: '내 위치' };
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
    const src = it.src === '미쉐린 빕구르망' ? '🏅' : '';
    const rate = it.rating ? `⭐${it.rating}` : '';
    return `<div class="item" data-id="${it.id}"><div class="ic">${ICON[it.type] || '📍'}</div>
      <div class="tx"><div class="nm">${esc(it.name)} ${src}${it.caution ? ' <span class="cau">⚠</span>' : ''}</div>
      <div class="sub">${esc(it.cuisine || it.cat)} · ${esc(it.city)} ${rate}</div>
      <div><span class="st ${x.oi.st}">${esc(x.oi.txt)}</span>${myRsv[it.id] ? ` <span class="rsvd">🎫 예약 ${esc(myRsv[it.id].w || '')}</span>` : (it.rsv ? ' <span class="rsvok">📅 예약</span>' : '')}</div></div>
      <div class="rt"><button class="heart" data-heart="${it.id}" aria-label="찜">${fav.has(it.id) ? '❤️' : '🤍'}</button><div class="dist">${fmtD(x.d)}</div></div></div>`;
  }
  function renderList() {
    const t = twNow();
    const L = filtered();
    const ref = myPos ? '📍 내 위치 기준' : `🏨 숙소 기준 (위치 권한을 허용하면 내 위치 기준)`;
    $('#refline').innerHTML = `${ref} · ${L.length}곳` + (S.when !== 'now' ? `<div class="preview">⏱ 미리보기: ${esc(t.label)} 기준 (설정에서 ‘지금’으로 바꾸기)</div>` : '');
    if (!L.length) { $('#list').innerHTML = (S.type === 'fav' ? '<div class="empty">목록 오른쪽의 🤍를 누르면 여기에 모여요.</div>' : '<div class="empty">조건에 맞는 곳이 없어요.<br>‘지금 영업 중만’을 끄고 다시 보세요.</div>'); return; }
    if (!myPos && S.city === '전체') {
      // 위치가 없으면 도시별로 나눠서 각 숙소 기준으로 보여줌
      const order = twNow().label === '지금' ? ['가오슝', '타이난'] : (S.when < '2026-11-14T13:00' ? ['타이난', '가오슝'] : ['가오슝', '타이난']);
      $('#list').innerHTML = order.map(c => { const LL = L.filter(x => x.it.city === c); return LL.length ? `<div class="sec">${c === '타이난' ? '🏯' : '🌉'} ${c} · ${esc(D.hotels[c].name)} 기준 (${LL.length}곳)</div>` + LL.slice(0, 150).map(rowHTML).join('') : ''; }).join('');
      return;
    }
    $('#list').innerHTML = L.slice(0, 200).map(rowHTML).join('');
  }
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
    const walk = d <= 1.2 ? `도보 약 ${Math.round(d * 1.35 * 1000 / 75)}분` : `택시·우버 약 ${Math.round(d * 1.35 / 22 * 60 + 3)}분`;
    $('#sheetIn').innerHTML = `<button class="close" data-x>✕</button>
      <h3>${ICON[it.type] || ''} ${esc(it.name)}</h3><div class="zh">${esc(it.zh)}</div>
      <div class="badges"><span class="badge">${esc(it.cat)}</span>${it.cuisine ? `<span class="badge">${esc(it.cuisine)}</span>` : ''}${it.src ? `<span class="badge ${srcCls}">${SRC_ICON[it.src] || ''} ${esc(it.src)}</span>` : ''}${it.b19 ? `<span class="badge cf">📝 먹을거리 게시판 추천 ${it.b19}건</span>` : ''}</div>
      <div><span class="st ${oi.st}">${esc(oi.txt)}</span> <small>(${esc(t.label)} 기준)</small></div>
      ${it.rating ? `<div class="kv">⭐ 구글 평점 <b style="display:inline">${it.rating}</b> · 리뷰 ${Number(it.reviews || 0).toLocaleString()}개</div>` : ''}
      <div class="btnrow"><a class="btn" href="${it.map}" target="_blank" rel="noopener">📍 구글맵 열기<br><small>리뷰·사진</small></a>
        <a class="btn green" href="${dirUrl(it, false)}" target="_blank" rel="noopener">🧭 길찾기<br><small>현재 위치에서</small></a></div>
      <div class="btnrow"><button class="btn dark" data-fav>${fav.has(it.id) ? '❤️ 찜 해제' : '🤍 찜하기'}</button>
        <button class="btn gray" data-taxi>🚕 주소 크게 보기</button></div>
      ${rsvHTML(it)}
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
  function loadGoogle() {
    return new Promise((ok, fail) => {
      if (!window.MAPS_KEY) return fail('no key');
      if (window.google && google.maps) return ok();
      window.__gmReady = ok;
      window.gm_authFailure = () => { fail('auth'); toast('구글 지도를 불러오지 못해 무료 지도로 보여드려요.'); useMap('osm'); };
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(window.MAPS_KEY)}&language=ko&region=TW&callback=__gmReady&loading=async`;
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
      if (!window.MAPS_KEY) { toast('구글 지도 키가 없어 무료 지도만 쓸 수 있어요.'); k = 'osm'; }
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
          label: { text: ICON[it.type] || '•', fontSize: '13px' },
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: 13, fillColor: COLOR[it.type], fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 } });
        mk.addListener('click', () => { E.google.info.setContent(popupHTML(it, x.oi)); E.google.info.open({ map: m, anchor: mk }); });
        E.google.items.push(mk);
      } else {
        const mk = L.marker([it.lat, it.lng], { icon: L.divIcon({ className: '', html: `<div class="mk" style="background:${COLOR[it.type]};opacity:${on ? 1 : .55}">${ICON[it.type] || ''}</div>`, iconSize: [26, 26] }) });
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
      if (!o.me) o.me = L.marker([myPos.lat, myPos.lng], { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [18, 18] }) }).addTo(o.map);
      else o.me.setLatLng([myPos.lat, myPos.lng]);
    }
  }
  function setView(lat, lng, z) {
    const m = E[cur].map; if (!m) return;
    cur === 'google' ? (m.setCenter({ lat, lng }), m.setZoom(z)) : m.setView([lat, lng], z);
  }
  function resizeMap() { if (E.osm.map && cur === 'osm') setTimeout(() => E.osm.map.invalidateSize(), 50); }
  document.addEventListener('click', e => { const a = e.target.closest('[data-open]'); if (a) { e.preventDefault(); openCard(a.dataset.open); } });
  $('#locBtn').addEventListener('click', () => { getPos(true); if (myPos) setView(myPos.lat, myPos.lng, 16); });
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
    if (activeTab === 'near') renderList();
    if (activeTab === 'map') drawMe();
  }
  function getPos(ask) {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(onPos, err => { if (ask) toast('위치를 가져오지 못했어요. 휴대폰 위치(GPS)와 브라우저 위치 권한을 확인해 주세요.'); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 20000 });
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
      notify(`${ICON[it.type]} 근처 ${Math.round(d)}m: ${it.name}`, `${it.cuisine || it.cat} · ${oi.txt}${it.rating ? ' · ⭐' + it.rating : ''}`, it.id);
    }
    LS.set('alerted', alerted);
  }
  async function startWatch() {
    if (!navigator.geolocation) { toast('이 브라우저는 위치 기능을 지원하지 않아요.'); return; }
    if ('Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch (e) { } }
    if (watchId == null) watchId = navigator.geolocation.watchPosition(onPos, () => { }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
    updatePerm();
  }
  function stopWatch() { if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; } updatePerm(); }
  function updatePerm() {
    const n = 'Notification' in window ? Notification.permission : '지원 안 함';
    const nk = { granted: '허용됨', denied: '차단됨 (브라우저 설정에서 허용 필요)', default: '아직 묻지 않음' }[n] || n;
    $('#permState').innerHTML = `알림 권한: <b>${nk}</b> · 위치 추적: <b>${watchId != null ? '작동 중' : '꺼짐'}</b>${S.when !== 'now' ? '<br>⚠ 기준 시각이 ‘지금’이 아니면 알림이 멈춰요.' : ''}`;
  }
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
  $$('#typeChips button').forEach(b => { b.classList.toggle('on', b.dataset.t === S.type); b.addEventListener('click', () => { S.type = b.dataset.t; saveS(); $$('#typeChips button').forEach(x => x.classList.toggle('on', x === b)); refresh(); }); });
  $('#openOnly').checked = S.openOnly;
  $('#openOnly').addEventListener('change', e => { S.openOnly = e.target.checked; saveS(); refresh(); });
  $('#when').innerHTML = PRESETS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  $('#when').value = S.when;
  $('#when').addEventListener('change', e => { S.when = e.target.value; saveS(); refresh(); updatePerm(); tick(); });
  let qT = null; $('#q').addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(refresh, 200); });
  $('#qBtn').addEventListener('click', () => { const q = $('#q'); q.classList.toggle('hidden'); if (!q.classList.contains('hidden')) q.focus(); else { q.value = ''; refresh(); } });

  // 설정
  $('#alertOn').checked = S.alertOn;
  $('#alertOn').addEventListener('change', e => { S.alertOn = e.target.checked; saveS(); S.alertOn ? startWatch() : stopWatch(); });
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
    fetch('info.html?v=20261018s').then(r => r.text()).then(h => { $('#info').innerHTML = h; infoLoaded = true; })
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
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => { });
    navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.open) openCard(e.data.open); });
  }

  // 상단(헤더) 높이를 CSS 변수로: 글씨 크기·화면 회전에 따라 겹치지 않게
  function setHH() { const h = $('#top').getBoundingClientRect().height; document.documentElement.style.setProperty('--hh', Math.round(h) + 'px'); resizeMap(); }
  window.addEventListener('resize', setHH);
  new ResizeObserver(setHH).observe($('#top'));

  // 시작
  tick();
  showTab('near');
  getPos(false);
  if (S.alertOn) startWatch();
  if (S.wakeOn) setWake(true);
  const h = location.hash.slice(1); if (BY_ID[h]) openCard(h);
  const qt = new URLSearchParams(location.search).get('tab'); if (qt) showTab(qt);
})();
