// Copyright (c) 2026 KIMYERANG. 무단 복제·배포·수정 금지
/**************************************************************
 * 연수 참석 등록부 웹앱 (Google Apps Script)
 * - 참석자: 직위·성명·서명 입력 → 등록 확인증 발급
 * - 스프레드시트는 '인쇄용 등록부' 서식(상단 제목·정보란 + 번호·직위·성명·서명 표)
 * - 서명은 '셀 안 이미지'(셀 크기에 맞춰 확대/축소, 정렬 시 함께 이동)
 * - 등록 시마다 직위 우선순위 → 성명 가나다순 자동 정렬, 번호 자동 부여
 * - 여러 연수 통합 등록 + 연수별 담당자 지정
 * - 관리자: 행사 생성/링크 발급(일시·장소·대상·연수부서) + 명단 조회 + 2단 인쇄본 생성
 *
 * 배포: Code.gs + Register.html + Admin.html → 웹 앱(실행:나, 액세스:모든 사용자)
 **************************************************************/

/* ===================== 설정 =====================
 * ★ 다른 학교에서 쓰시려면 이 블록만 고치면 됩니다.
 *   교표는 코드가 아니라 '교표설정하기' 함수로 넣습니다. (없어도 됩니다)
 *   담당자 비밀번호도 코드가 아니라 [프로젝트 설정 → 스크립트 속성]에
 *   ADMIN_PASSWORD 라는 이름으로 넣습니다. (아래 설명 참고)
 */
const CONFIG = {
  ORG_NAME: '전북특별자치도교육청',        // 상급 기관명
  SCHOOL_NAME: '전주솔내고등학교',          // 학교(기관)명
  SCHOOL_NAME_EN: 'Jeonju Solnae High School',  // 등록 화면 교표 옆 영문명
  SYSTEM_TITLE: '통합연수등록시스템',       // 등록 화면 상단 큰 제목
  REPORT_TITLE: '교직원 연수 등록부',       // 등록부(시트) 상단 제목
  AUTHUSER: '0',                        // 링크에 authuser 파라미터 자동 추가(계정 꼬임 방지). 비우면('') 미추가
  DEFAULT_POSITIONS: ['교장', '교감', '행정실장', '수석교사', '교사', '주무관', '교무실무사', '특수지도사', '기숙사사감', '시설관리원', '행정실무사', '영양실무사'],
  POSITION_ORDER: ['교장', '교감', '행정실장', '수석교사', '교사', '주무관', '교무실무사', '특수지도사', '기숙사사감', '시설관리원', '행정실무사', '영양실무사'],
  SIG_ROW_HEIGHT: 64,   // 표 데이터 행 높이(px)
  SIG_COL_WIDTH: 190    // 서명 열 너비(px)
};

/* ===== 시트 레이아웃 =====
   1행: 제목(병합)   2행: 학교명(오른쪽)
   3~7행: 정보란(주제/일시/대상/장소/연수 부서)
   8행: 표 머리글(번호·직위·성명·서명)   9행~: 데이터
   보이는 열 A~D, 숨김 열 E(등록시간)·F(서명데이터)·G(정렬키) */
const TITLE_ROW = 1;
const SCHOOL_ROW = 2;
const META_START_ROW = 3;
const TABLE_HEADER_ROW = 8;
const DATA_START_ROW = 9;
const TABLE_HEADERS = ['번호', '직위', '성명', '서명'];
const VISIBLE_COLS = 4;

/* 설치 안내 시트. 등록부가 아니라 읽을거리이므로 연수 목록에서 제외한다.
   이름을 바꾸시려면 여기만 고치면 됩니다. */
const GUIDE_SHEET_NAME = '📖 설치 안내';

/* 교표를 담아두는 스크립트 속성 이름.
   비밀번호와 마찬가지로 사본에 딸려가지 않으므로, 다른 학교가 남의 교표를
   달고 시작하는 일이 없다. 값은 data:image/... 또는 https:// 둘 다 된다. */
const EMBLEM_PROP = 'SCHOOL_EMBLEM';

const NO_COL = 1;
const POS_COL = 2;
const NAME_COL = 3;
const SIG_DISPLAY_COL = 4;
const TIME_COL = 5;
const SIG_DATA_COL = 6;
const SORT_KEY_COL = 7;
const TOTAL_COLS = 7;

/* ===================== 라우팅 ===================== */
function doGet(e) {
  const p = (e && e.parameter) ? e.parameter : {};
  const mode = p.mode || 'register';

  if (mode === 'admin') {
    const t = HtmlService.createTemplateFromFile('Admin');
    t.webAppUrl = getWebAppUrl_();
    t.schoolName = CONFIG.SCHOOL_NAME;
    t.defaultPositions = CONFIG.DEFAULT_POSITIONS.join(',');
    return t.evaluate()
      .setTitle('연수 등록부 · 담당자 메뉴')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  const t = HtmlService.createTemplateFromFile('Register');
  const evNames  = decodeList_(p.events) || (p.title ? [p.title] : ['연수 참석 등록']);
  const evAdmins = decodeRaw_(p.admins);
  const evDepts  = decodeRaw_(p.depts);
  t.eventList  = evNames.map(function (n, i) { return { name: n, admin: evAdmins[i] || '', dept: evDepts[i] || '' }; });
  t.eventTitle = p.title || (evNames.length === 1 ? evNames[0] : '연수 참석 등록');
  t.orgName      = CONFIG.ORG_NAME;
  t.webAppUrl    = getWebAppUrl_();
  t.schoolName   = p.school  || CONFIG.SCHOOL_NAME;
  t.schoolNameEn = CONFIG.SCHOOL_NAME_EN;
  t.systemTitle  = CONFIG.SYSTEM_TITLE;
  t.emblemSrc    = getEmblem_();
  t.positions    = decodeList_(p.pos)  || CONFIG.DEFAULT_POSITIONS;
  t.metaDate     = p.date     || '';
  t.metaMethod   = p.method   || '';
  t.metaTarget   = p.target   || '';
  return t.evaluate()
    .setTitle(t.eventTitle)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ===================== 등록 처리 ===================== */
function registerAttendance(data) {
  if (!data || !data.name || !data.position || !data.signature) {
    throw new Error('필수 항목(직위·성명·서명)이 누락되었습니다.');
  }
  if (!isSignatureDataUrl_(data.signature)) {
    throw new Error('서명 형식이 올바르지 않습니다.');
  }
  let rawEvents = data.events;
  if (typeof rawEvents === 'string') {
    const s = rawEvents.trim();
    if (s.charAt(0) === '[') { try { rawEvents = JSON.parse(s); } catch (e) { rawEvents = [s]; } }
    else { rawEvents = s ? [s] : []; }
  }
  if (rawEvents == null) rawEvents = [];
  if (!Array.isArray(rawEvents)) rawEvents = [rawEvents];
  if (!rawEvents.length && data.eventTitle) rawEvents = [data.eventTitle];
  const events = rawEvents.map(function (e) {
    if (e && typeof e === 'object') {
      return { name: String(e.name || '').trim(), admin: String(e.admin || '').trim(), dept: String(e.dept || '').trim() };
    }
    return { name: String(e).trim(), admin: '', dept: '' };
  }).filter(function (e) { return e.name; });
  if (!events.length) throw new Error('등록할 연수가 선택되지 않았습니다.');

  const meta = data.meta || {};
  const ss = openSpreadsheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const now = new Date();
    const timeStr = Utilities.formatDate(now, ss.getSpreadsheetTimeZone(), 'yyyy. MM. dd. a hh:mm:ss')
      .replace('AM', '오전').replace('PM', '오후');
    const rank = positionRank_(data.position);

    events.forEach(function (ev) {
      const sheet = getEventSheet_(ss, ev.name, ev.admin, ev.dept, meta);
      sheet.appendRow([
        '',                    // 번호(정렬 후 자동)
        data.position || '',   // 직위
        data.name || '',       // 성명
        '',                    // 서명(셀 안 이미지)
        timeStr,               // 등록시간(숨김)
        data.signature || '',  // 서명데이터(숨김)
        rank                   // 정렬키(숨김)
      ]);
      const row = sheet.getLastRow();
      insertSignatureImage_(sheet, row, data.signature);
      sortSheet_(sheet);
    });
    SpreadsheetApp.flush();

    return {
      events: events,
      org: (data.school || CONFIG.SCHOOL_NAME),
      position: data.position || '',
      name: data.name || '',
      signature: data.signature || '',
      time: timeStr
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 서명값이 캔버스가 만든 PNG dataURL 형식인지 검사.
 * 시작만 보고 통과시키면 'data:image/png;base64,AAA" onerror="...' 같은 값이
 * 시트에 저장됐다가 담당자 명단 화면에서 <img> 속성을 탈출해 실행된다.
 */
function isSignatureDataUrl_(s) {
  return /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(String(s || ''));
}

/** 직위 우선순위(작을수록 위). 목록에 없으면 999. */
function positionRank_(pos) {
  const i = CONFIG.POSITION_ORDER.indexOf(String(pos || '').trim());
  return i === -1 ? 999 : i;
}

/** 서명 dataURL을 '셀 안 이미지'로 삽입 */
function insertSignatureImage_(sheet, row, dataUrl) {
  if (!dataUrl || dataUrl.indexOf('data:image') !== 0) return;
  try {
    const image = SpreadsheetApp.newCellImage().setSourceUrl(dataUrl).setAltTextTitle('서명').build();
    sheet.getRange(row, SIG_DISPLAY_COL).setValue(image);
  } catch (err) { /* 실패해도 등록 유지 */ }
}

/** [직위 우선순위 → 성명 가나다순] 정렬 + 번호 재부여 + 표 서식 */
function sortSheet_(sheet) {
  const last = sheet.getLastRow();
  const n = last - DATA_START_ROW + 1;
  if (n < 1) return;
  try {
    if (n >= 2) {
      sheet.getRange(DATA_START_ROW, 1, n, TOTAL_COLS).sort([
        { column: SORT_KEY_COL, ascending: true },
        { column: NAME_COL, ascending: true }
      ]);
    }
    const nums = [];
    for (var i = 0; i < n; i++) nums.push([i + 1]);
    sheet.getRange(DATA_START_ROW, NO_COL, n, 1).setValues(nums);

    const body = sheet.getRange(DATA_START_ROW, 1, n, VISIBLE_COLS);
    body.setBorder(true, true, true, true, true, true);
    body.setVerticalAlignment('middle').setHorizontalAlignment('center');
    sheet.setRowHeights(DATA_START_ROW, n, CONFIG.SIG_ROW_HEIGHT);
  } catch (err) { /* 실패해도 등록 유지 */ }
}

/* ===================== 시트/서식 ===================== */
function getEventSheet_(ss, eventName, admin, dept, meta) {
  const name = sheetNameFor_(eventName);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    buildEventHeader_(sheet, eventName, admin, dept, meta);
  } else if (sheet.getRange(TABLE_HEADER_ROW, NO_COL).getValue() !== '번호') {
    buildEventHeader_(sheet, eventName, admin, dept, meta);
  }
  return sheet;
}

/** 인쇄용 상단 서식(제목·학교명·정보란·표 머리글) 구성 */
function buildEventHeader_(sheet, eventName, admin, dept, meta) {
  meta = meta || {};
  const target = meta.target || (CONFIG.SCHOOL_NAME + ' 교직원');

  sheet.getRange(TITLE_ROW, 1, 1, VISIBLE_COLS).merge()
    .setValue(CONFIG.REPORT_TITLE)
    .setFontSize(18).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setBorder(true, true, true, true, null, null, '#1a4fb4', SpreadsheetApp.BorderStyle.SOLID_THICK);
  sheet.setRowHeight(TITLE_ROW, 46);

  sheet.getRange(SCHOOL_ROW, 1, 1, VISIBLE_COLS).merge()
    .setValue(CONFIG.SCHOOL_NAME)
    .setFontWeight('bold').setHorizontalAlignment('right').setVerticalAlignment('middle');
  sheet.setRowHeight(SCHOOL_ROW, 26);

  const lines = [
    '▢  주제 : ' + eventName,
    '▢  일시 : ' + (meta.date || ''),
    '▢  대상 : ' + target,
    '▢  장소 : ' + (meta.method || ''),
    '▢  연수 부서 : ' + (dept || '') + (admin ? '   ( 담당 ' + admin + ' )' : '')
  ];
  for (var i = 0; i < lines.length; i++) {
    const r = META_START_ROW + i;
    sheet.getRange(r, 1, 1, VISIBLE_COLS).merge()
      .setValue(lines[i]).setFontSize(11)
      .setHorizontalAlignment('left').setVerticalAlignment('middle');
    sheet.setRowHeight(r, 24);
  }

  sheet.getRange(TABLE_HEADER_ROW, 1, 1, VISIBLE_COLS).setValues([TABLE_HEADERS])
    .setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setBackground('#eef3fc')
    .setBorder(true, true, true, true, true, true);
  sheet.setRowHeight(TABLE_HEADER_ROW, 30);
  sheet.getRange(TABLE_HEADER_ROW, TIME_COL, 1, 3).setValues([['등록시간', '서명데이터', '정렬키']]);

  sheet.setColumnWidth(NO_COL, 52);
  sheet.setColumnWidth(POS_COL, 96);
  sheet.setColumnWidth(NAME_COL, 96);
  sheet.setColumnWidth(SIG_DISPLAY_COL, CONFIG.SIG_COL_WIDTH);
  sheet.hideColumns(TIME_COL, 3);
  sheet.setFrozenRows(TABLE_HEADER_ROW);
}

/* ===================== 담당자 인증 =====================
 * 비밀번호는 코드에 두지 않는다. 코드를 나눠주면 비밀번호도 같이 퍼지고,
 * 받는 쪽이 변경을 잊으면 그대로 뚫리기 때문이다.
 *
 * 설정 방법: Apps Script 편집기 → 왼쪽 [프로젝트 설정] → 맨 아래
 *           [스크립트 속성] → 속성 추가
 *           속성 이름: ADMIN_PASSWORD    값: (원하는 비밀번호)
 * 설정하지 않으면 담당자 화면은 열리지 않는다(빈 비밀번호로 통과 불가).
 */
function getAdminPassword_() {
  const pw = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!pw) {
    throw new Error('담당자 비밀번호가 설정되지 않았습니다. '
      + '[프로젝트 설정 → 스크립트 속성]에서 ADMIN_PASSWORD를 추가하세요.');
  }
  return pw;
}

/** 관리자 전용 함수의 공통 관문. 통과 못 하면 예외를 던진다. */
function requireAdmin_(params) {
  if (!params || String(params.password || '') !== getAdminPassword_()) {
    throw new Error('비밀번호가 올바르지 않습니다.');
  }
}

/** 담당자 비밀번호 확인 (화면 잠금 해제용) */
function verifyAdmin(pw) {
  return String(pw || '') === getAdminPassword_();
}

/* ===================== 관리자: 명단 조회 ===================== */
function getAttendees(params) {
  requireAdmin_(params);
  const ss = openSpreadsheet_();
  const sheet = params.eventTitle
    ? ss.getSheetByName(sheetNameFor_(params.eventTitle))
    : firstEventSheet_(ss);
  if (!sheet) return { headers: TABLE_HEADERS, rows: [] };

  const last = sheet.getLastRow();
  if (last < DATA_START_ROW) return { headers: TABLE_HEADERS, count: 0, rows: [] };
  const n = last - DATA_START_ROW + 1;
  const vals = sheet.getRange(DATA_START_ROW, 1, n, TOTAL_COLS).getValues();
  const rows = vals.map(function (r) {
    return { no: r[0], position: r[1], name: r[2], time: r[4], signature: r[5] };
  });
  return { headers: TABLE_HEADERS, count: rows.length, rows: rows };
}

/* ===================== 관리자: 시트 목록 ===================== */
function listEventSheets(params) {
  requireAdmin_(params);
  const ss = openSpreadsheet_();
  return eventSheets_(ss).map(function (s) {
    return { name: s.getName(), rows: Math.max(0, s.getLastRow() - (DATA_START_ROW - 1)) };
  });
}

/**
 * 안내 시트를 뺀 '진짜 등록부 시트'만 추린다.
 * 이름이 일치하는 것뿐 아니라 그것으로 시작하는 것도 뺀다 —
 * 안내 시트를 다시 만들다 중간에 실패하면 '(교체중 ...)'가 붙은 시트가
 * 남을 수 있는데, 그것이 연수 목록에 뜨면 안 되기 때문이다.
 */
function eventSheets_(ss) {
  return ss.getSheets().filter(function (s) {
    return s.getName().indexOf(GUIDE_SHEET_NAME) !== 0;
  });
}

/** 연수를 고르지 않았을 때 기본으로 볼 시트. 안내 시트가 맨 앞이어도 건너뛴다. */
function firstEventSheet_(ss) {
  const list = eventSheets_(ss);
  return list.length ? list[0] : null;
}

/* ===================== 관리자: 등록 링크 생성 ===================== */
function buildRegisterLink(params) {
  requireAdmin_(params);
  const base = getWebAppUrl_();
  const q = ['mode=register'];
  if (params.title)    q.push('title='    + encodeURIComponent(params.title));
  if (params.events)   q.push('events='   + encodeURIComponent(encodeList_(params.events)));
  if (params.admins)   q.push('admins='   + encodeURIComponent(encodeRaw_(params.admins)));
  if (params.school)   q.push('school='   + encodeURIComponent(params.school));
  if (params.date)     q.push('date='     + encodeURIComponent(params.date));
  if (params.method)   q.push('method='   + encodeURIComponent(params.method));
  if (params.target)   q.push('target='   + encodeURIComponent(params.target));
  if (params.depts)    q.push('depts='    + encodeURIComponent(encodeRaw_(params.depts)));
  if (params.positions) q.push('pos=' + encodeURIComponent(encodeList_(params.positions)));
  if (CONFIG.AUTHUSER) q.push('authuser=' + encodeURIComponent(CONFIG.AUTHUSER));
  return base + '?' + q.join('&');
}

/* ===================== 관리자: 2단 인쇄본 생성 ===================== */
function makePrintSheet(params) {
  requireAdmin_(params);
  const ss = openSpreadsheet_();
  const src = params.eventTitle
    ? ss.getSheetByName(sheetNameFor_(params.eventTitle))
    : firstEventSheet_(ss);
  if (!src) throw new Error('해당 연수 시트를 찾을 수 없습니다.');
  const last = src.getLastRow();
  const n = last - DATA_START_ROW + 1;
  if (n < 1) throw new Error('등록된 참석자가 없습니다.');

  const vals = src.getRange(DATA_START_ROW, 1, n, TOTAL_COLS).getValues();
  const people = vals.map(function (r) {
    return { pos: r[POS_COL - 1], name: r[NAME_COL - 1], sig: r[SIG_DATA_COL - 1] };
  });
  const metaLines = [];
  for (var r = META_START_ROW; r < TABLE_HEADER_ROW; r++) {
    metaLines.push(src.getRange(r, 1).getValue());
  }

  const pname = (src.getName() + ' (인쇄)').slice(0, 96);
  let ps = ss.getSheetByName(pname);
  if (ps) ss.deleteSheet(ps);
  ps = ss.insertSheet(pname);
  buildPrintLayout_(ps, metaLines, people);
  SpreadsheetApp.flush();
  return { ok: true, sheetName: pname, count: n };
}

/** 2단(좌·우) 인쇄 레이아웃: 순·직위·성명·서명 × 2블록 */
function buildPrintLayout_(ps, metaLines, people) {
  const HDR = ['순', '직위', '성명', '서명', '순', '직위', '성명', '서명'];
  ps.getRange(1, 1, 1, 8).merge().setValue(CONFIG.REPORT_TITLE)
    .setFontSize(18).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setBorder(true, true, true, true, null, null, '#1a4fb4', SpreadsheetApp.BorderStyle.SOLID_THICK);
  ps.setRowHeight(1, 46);
  ps.getRange(2, 1, 1, 8).merge().setValue(CONFIG.SCHOOL_NAME)
    .setFontWeight('bold').setHorizontalAlignment('right').setVerticalAlignment('middle');
  ps.setRowHeight(2, 26);
  for (var i = 0; i < metaLines.length; i++) {
    ps.getRange(META_START_ROW + i, 1, 1, 8).merge()
      .setValue(metaLines[i]).setFontSize(11)
      .setHorizontalAlignment('left').setVerticalAlignment('middle');
    ps.setRowHeight(META_START_ROW + i, 24);
  }
  ps.getRange(TABLE_HEADER_ROW, 1, 1, 8).setValues([HDR])
    .setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setBackground('#eef3fc').setBorder(true, true, true, true, true, true);
  ps.setRowHeight(TABLE_HEADER_ROW, 30);

  const total = people.length;
  const half = Math.ceil(total / 2);
  const rows = [];
  for (var k = 0; k < half; k++) {
    const L = people[k];
    const R = people[half + k];
    rows.push([
      k + 1, L ? L.pos : '', L ? L.name : '', '',
      R ? (half + k + 1) : '', R ? R.pos : '', R ? R.name : '', ''
    ]);
  }
  if (rows.length) {
    ps.getRange(DATA_START_ROW, 1, rows.length, 8).setValues(rows);
    for (var m = 0; m < half; m++) {
      const rr = DATA_START_ROW + m;
      if (people[m] && String(people[m].sig).indexOf('data:image') === 0) {
        setCellSignature_(ps, rr, 4, people[m].sig);
      }
      if (people[half + m] && String(people[half + m].sig).indexOf('data:image') === 0) {
        setCellSignature_(ps, rr, 8, people[half + m].sig);
      }
    }
    const body = ps.getRange(DATA_START_ROW, 1, rows.length, 8);
    body.setBorder(true, true, true, true, true, true).setVerticalAlignment('middle');
    ps.getRange(DATA_START_ROW, 1, rows.length, 8).setHorizontalAlignment('center');
    ps.setRowHeights(DATA_START_ROW, rows.length, CONFIG.SIG_ROW_HEIGHT);
  }
  const w = [40, 84, 90, 150, 40, 84, 90, 150];
  for (var c = 0; c < 8; c++) ps.setColumnWidth(c + 1, w[c]);
  ps.setFrozenRows(TABLE_HEADER_ROW);
}

function setCellSignature_(sheet, row, col, dataUrl) {
  try {
    const image = SpreadsheetApp.newCellImage().setSourceUrl(dataUrl).setAltTextTitle('서명').build();
    sheet.getRange(row, col).setValue(image);
  } catch (err) { /* skip */ }
}

/* ===================== 교표 =====================
 * 교표는 없어도 된다. 없으면 등록 화면에 학교명만 나오고 나머지는 그대로
 * 동작한다. 설치할 때 교표에서 막혀 포기하는 일이 없도록 선택사항으로 뒀다.
 */

/** 등록 화면에 넣을 교표 주소. 설정 안 했으면 빈 문자열. */
function getEmblem_() {
  return PropertiesService.getScriptProperties().getProperty(EMBLEM_PROP) || '';
}

/**
 * 구글 드라이브에 올려둔 교표 이미지를 찾아 등록한다.
 *
 * 쓰는 법
 *   1. 교표 이미지를 구글 드라이브에 올리고 파일 이름을 '교표'로 바꾼다
 *   2. 편집기 함수 목록에서 '교표설정하기' 선택 → ▶ 실행
 *   3. 등록 화면을 새로고침하면 교표가 보인다
 *
 * 교표를 바꾸려면 드라이브 파일만 갈아끼우고 다시 실행하면 된다.
 * 변환 사이트에 갈 필요도, 긴 문자열을 복사할 필요도 없다.
 */
function 교표설정하기() {
  const q = 'title contains "교표" and mimeType contains "image/" and trashed = false';
  const it = DriveApp.searchFiles(q);
  const found = [];
  while (it.hasNext()) found.push(it.next());

  if (!found.length) {
    throw new Error('드라이브에서 이름에 "교표"가 들어간 이미지 파일을 찾지 못했습니다. '
      + '교표 이미지를 구글 드라이브에 올리고 파일 이름을 "교표"로 바꾼 뒤 다시 실행하세요.');
  }
  found.sort(function (a, b) { return b.getLastUpdated() - a.getLastUpdated(); });
  const file = found[0];

  const blob = file.getBlob();
  const bytes = blob.getBytes();
  const kb = Math.round(bytes.length / 1024);

  // 교표는 페이지를 열 때마다 통째로 전송된다. 너무 크면 등록 화면이 느려진다.
  if (bytes.length > 500 * 1024) {
    throw new Error('교표 파일이 ' + kb + 'KB로 너무 큽니다. '
      + '그림판이나 사진 앱에서 가로 100픽셀 내외로 줄여서 다시 올려주세요. '
      + '(화면에는 높이 32픽셀로 나옵니다)');
  }

  const dataUrl = 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(bytes);
  PropertiesService.getScriptProperties().setProperty(EMBLEM_PROP, dataUrl);

  Logger.log('교표를 등록했습니다.  파일: %s (%sKB)', file.getName(), kb);
  if (found.length > 1) {
    Logger.log('※ "교표"가 들어간 파일이 %s개 있어 가장 최근에 수정한 것을 썼습니다.', found.length);
  }
  if (bytes.length > 100 * 1024) {
    Logger.log('※ %sKB는 다소 큽니다. 등록 화면이 느리면 가로 100픽셀 내외로 줄여 다시 실행하세요.', kb);
  }
  Logger.log('등록 화면을 새로고침해서 확인하세요. 교표가 이상하면 파일을 바꾸고 다시 실행하면 됩니다.');
}

/** 교표를 뺀다. 등록 화면에는 학교명만 나온다. */
function 교표지우기() {
  PropertiesService.getScriptProperties().deleteProperty(EMBLEM_PROP);
  Logger.log('교표를 지웠습니다. 등록 화면에는 학교명만 나옵니다.');
}

/* ===================== 설치 안내 시트 =====================
 * 템플릿을 만드는 사람만 이 함수를 한 번 실행하면 된다.
 * 사본을 받는 학교는 실행할 필요가 없다 — 시트가 사본에 그대로 따라온다.
 *
 * 실행법: 편집기 위쪽 함수 목록에서 '설치안내시트만들기' 선택 → ▶ 실행
 * 다시 실행하면 기존 안내 시트를 지우고 새로 만든다.
 *
 * ★ 끝에 SpreadsheetApp.getUi().alert()를 부르면 안 된다. 알림창은
 *   스프레드시트 탭에 뜨는데 편집기에서 실행하면 그 탭을 보고 있지 않으므로,
 *   아무도 누르지 않는 [확인]을 기다리다 시간 초과로 죽는다.
 *   결과는 실행 로그로 알린다.
 */
function 설치안내시트만들기() {
  const t0 = Date.now();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('스프레드시트에서 [확장 프로그램 → Apps Script]로 열어 실행하세요.');

  // ★ 새로 만든 뒤에 옛 시트를 지운다. 순서를 반대로 하면, 안내 시트가
  //   문서의 유일한 시트일 때(연수 시트가 아직 없는 새 사본이 그렇다)
  //   '문서의 모든 시트를 삭제할 수 없습니다' 오류로 막힌다.
  //   이름을 잠시 바꿔두는 건 새 시트와 이름이 겹치지 않게 하기 위함이다.
  const old = ss.getSheetByName(GUIDE_SHEET_NAME);
  if (old) old.setName(GUIDE_SHEET_NAME + ' (교체중 ' + Date.now() + ')');

  const sh = ss.insertSheet(GUIDE_SHEET_NAME, 0);   // 맨 앞 탭으로
  buildGuideSheet_(sh);
  if (old) ss.deleteSheet(old);

  SpreadsheetApp.flush();
  Logger.log('‘%s’ 시트를 만들었습니다. (%s초)  스프레드시트 탭에서 확인하세요.',
             GUIDE_SHEET_NAME, ((Date.now() - t0) / 1000).toFixed(1));
}

/** 안내 문구. [종류, 내용] 목록이며 서식은 buildGuideSheet_가 입힌다. */
function guideContent_() {
  return [
    ['title', '연수 참석 등록부 · 설치 안내'],
    ['sub',   'QR을 찍으면 참석자가 휴대폰에서 직위·성명·서명을 남기고, 이 스프레드시트에 인쇄용 등록부가 자동으로 쌓입니다. 연수가 끝나면 그대로 출력해 결재 올리시면 됩니다.'],
    ['sub',   '아래 순서대로 20분이면 끝납니다. 코딩 지식은 필요 없습니다.'],
    ['gap',   ''],

    ['h', '1단계 · 우리 학교에 맞추기'],
    ['p', '상단 메뉴 [확장 프로그램] → [Apps Script] 를 누르면 편집기가 열립니다. Code.gs 파일 맨 위 CONFIG 부분만 고치시면 됩니다.'],
    ['code', "ORG_NAME: '전북특별자치도교육청',              ← 우리 교육청\nSCHOOL_NAME: '전주솔내고등학교',                ← 우리 학교\nSCHOOL_NAME_EN: 'Jeonju Solnae High School',  ← 영문 학교명\nSYSTEM_TITLE: '통합연수등록시스템',             ← 등록 화면 제목\nREPORT_TITLE: '교직원 연수 등록부',             ← 출력물 제목\nDEFAULT_POSITIONS: ['교장', '교감', ...]       ← 고를 수 있는 직위\nPOSITION_ORDER: ['교장', '교감', ...]          ← 출력물 정렬 순서"],
    ['warn', '작은따옴표 \' 와 쉼표 , 는 지우지 마세요. 따옴표 사이의 글자만 바꾸시면 됩니다.'],
    ['p', '다 고치셨으면 Ctrl+S 로 저장하세요.'],
    ['gap', ''],

    ['h', '2단계 · 교표 넣기  (건너뛰어도 됩니다)'],
    ['tip', '교표는 선택사항입니다. 안 넣으면 등록 화면에 학교명만 나오고, 등록·서명·출력은 전혀 지장 없습니다. 지금 번거로우면 건너뛰고 나중에 하셔도 됩니다.'],
    ['li', '① 교표 이미지를 구글 드라이브에 올리고, 파일 이름을 「교표」로 바꿉니다. (교표.png, 우리학교 교표 처럼 "교표"가 들어가기만 하면 됩니다)'],
    ['li', '② 편집기 위쪽 함수 목록에서 「교표설정하기」를 고르고 ▶ 실행을 누릅니다. 목록이 알파벳순이라 한글 이름은 맨 아래에 있습니다.'],
    ['li', '③ 등록 화면을 새로고침하면 교표가 보입니다.'],
    ['p', '교표를 바꾸시려면 드라이브 파일만 갈아끼우고 「교표설정하기」를 다시 실행하면 됩니다. 빼고 싶으면 「교표지우기」를 실행하세요.'],
    ['tip', '교표는 가로 100픽셀 내외로 줄여서 올리세요. 화면에는 높이 32픽셀로 나옵니다. 원본 사진을 그대로 올리면 등록 화면이 느려지고, 500KB가 넘으면 함수가 막아줍니다.'],
    ['warn', '이미 인터넷에 올라간 교표 주소가 있다면 함수 대신 [⚙ 프로젝트 설정 → 스크립트 속성]에 SCHOOL_EMBLEM 이라는 이름으로 그 주소(https://...)를 직접 넣으셔도 됩니다.'],
    ['gap', ''],

    ['h', '3단계 · 담당자 비밀번호 정하기'],
    ['danger', '이걸 안 하면 담당자 메뉴가 열리지 않습니다. 일부러 그렇게 만들었습니다. 비밀번호는 사본에 딸려오지 않으니 학교마다 직접 정하셔야 합니다.'],
    ['p', '편집기 왼쪽 [⚙ 프로젝트 설정] → 맨 아래 [스크립트 속성] → [스크립트 속성 추가] 를 누르고 아래와 같이 입력한 뒤 저장하세요.'],
    ['code', '속성 :  ADMIN_PASSWORD\n값   :  (원하는 비밀번호)'],
    ['tip', '코드에 비밀번호를 적지 않는 이유 — 프로그램을 다른 학교에 나눠줄 때 비밀번호까지 같이 퍼지기 때문입니다.'],
    ['gap', ''],

    ['h', '4단계 · 배포하기'],
    ['p', '편집기 오른쪽 위 [배포] → [새 배포] → ⚙(톱니바퀴) → [웹 앱] 을 고르고 아래와 같이 설정한 뒤 [배포]를 누르세요.'],
    ['code', '다음 사용자로 실행        :  나\n액세스 권한이 있는 사용자 :  모든 사용자'],
    ['warn', "'모든 사용자'가 아니면 참석자가 로그인을 요구받아 등록을 못 합니다. 시트 내용이 공개되는 게 아니라 등록 화면만 열리는 것이니 안심하셔도 됩니다."],
    ['gap', ''],

    ['h', '5단계 · 권한 승인 (무서운 경고 넘기기)'],
    ['p', '처음 배포하면 빨간 경고가 뜹니다. 정상입니다. 구글에 심사비를 내고 등록한 앱이 아니라서 뜨는 것뿐입니다.'],
    ['li', '① [액세스 승인] 클릭  →  ② 본인 구글 계정 선택'],
    ['li', '③ "Google에서 확인하지 않은 앱입니다" 화면이 나오면 → 왼쪽 아래 [고급]'],
    ['li', '④ [(프로젝트 이름)(으)로 이동(안전하지 않음)] 클릭  →  ⑤ [허용]'],
    ['tip', '안심하셔도 되는 이유 — 이 앱은 방금 복사한 선생님 소유의 이 스프레드시트에만 접근합니다. 코드는 편집기에서 언제든 열어보실 수 있고, 데이터가 외부로 나가는 곳은 없습니다.'],
    ['p', '승인이 끝나면 웹 앱 URL 이 나옵니다. https://script.google.com/macros/s/....../exec 형태입니다. 이 주소를 메모해두세요.'],
    ['gap', ''],

    ['h', '6단계 · 연수 만들고 링크·QR 뽑기'],
    ['li', '① 웹 앱 URL 뒤에 ?mode=admin 을 붙여 접속합니다. 등록 화면 맨 아래 [담당자 메뉴] 링크로도 갈 수 있습니다.'],
    ['li', '② 3단계에서 정한 비밀번호로 입장'],
    ['li', '③ [행사 생성 / 링크 발급] 탭에서 연수명·연수부서·담당자·일시·장소·대상을 입력'],
    ['li', '④ [등록 링크 만들기] → [링크 복사]'],
    ['li', '⑤ 복사한 링크를 QR 생성 사이트(qr.naver.com 등)에 붙여넣고 이미지를 받으세요. 연수 PPT 첫 장에 띄우거나 출력해서 입구에 붙여두시면 됩니다.'],
    ['tip', '여러 연수를 한 번에 — 연수를 여러 줄 넣으면 참석자가 한 번의 서명으로 여러 연수에 등록됩니다. 각 연수는 별도 시트 탭에 따로 저장됩니다. 연수 서너 개를 몰아서 하는 날 유용합니다.'],
    ['gap', ''],

    ['h', '연수가 끝난 뒤 · 출력하기'],
    ['li', '① 담당자 메뉴 → [참석자 명단 조회] 탭에서 연수를 고르고 [명단 불러오기]'],
    ['li', '② [2단 인쇄본 만들기] 를 누르면 「연수명 (인쇄)」 시트가 생깁니다'],
    ['li', '③ 그 탭을 열어 [파일] → [인쇄]. 인쇄 설정에서 "페이지에 맞추기"를 켜세요'],
    ['gap', ''],

    ['h', '설정을 고친 뒤 · 재배포'],
    ['p', 'CONFIG 나 교표를 수정하면 저장만으로는 반영되지 않습니다. [배포] → [배포 관리] → ✏️(연필) → 버전을 [새 버전] 으로 → [배포] 하시면 됩니다. 이렇게 하면 URL이 그대로 유지되어 이미 뿌린 QR을 다시 만들 필요가 없습니다.'],
    ['danger', '수정할 때 [새 배포]를 누르면 URL이 새로 생겨 기존 QR이 전부 무효가 됩니다. 연수 당일에 사고가 납니다. 반드시 [배포 관리]로 들어가세요.'],
    ['gap', ''],

    ['h', '잘 안 될 때'],
    ['li', '"담당자 비밀번호가 설정되지 않았습니다" → 3단계를 안 했거나 속성 이름 오타. ADMIN_PASSWORD 를 대문자·밑줄까지 정확히'],
    ['li', '"비밀번호가 올바르지 않습니다" → 3단계에서 넣은 값과 다름. 앞뒤 공백 주의'],
    ['li', '참석자가 로그인을 요구받음 → 4단계에서 액세스가 "모든 사용자"가 아님'],
    ['li', '고친 게 반영이 안 됨 → 재배포를 안 함. 위 "재배포" 참고'],
    ['li', '서명이 시트에 안 보임 → 서명 열 너비나 행 높이가 눌린 경우. CONFIG 의 SIG_COL_WIDTH · SIG_ROW_HEIGHT 조정'],
    ['gap', ''],

    ['h', '개인정보 관련'],
    ['p', '이 앱은 성명·직위·서명 이미지를 수집합니다. 서명은 개인정보에 해당합니다. 데이터는 선생님 학교의 구글 드라이브에만 저장되고 외부로 전송되지 않습니다. 학교 개인정보 처리 방침에 따라 보존 기간이 지난 등록부는 정리하세요.'],
    ['danger', '이 스프레드시트의 공유 설정을 확인하세요. 웹앱 접근 권한과 시트 공유는 별개입니다. 시트를 "링크가 있는 모든 사용자"로 공유해두면 참석자 명단과 서명이 그대로 노출됩니다. 시트는 비공개로 두세요.'],
    ['gap', ''],

    ['h', '프로그램 구성'],
    ['p', '궁금하신 분을 위한 참고입니다. 고치실 필요는 없습니다.'],
    ['li', 'Code.gs — 등록 처리, 시트 서식, 정렬, 인쇄본 생성 (CONFIG 블록만 수정)'],
    ['li', 'Register.html — 참석자용 등록 화면, 서명 캔버스 (수정 불필요)'],
    ['li', 'Admin.html — 담당자 화면, 링크 발급·명단·인쇄 (수정 불필요)'],
    ['li', '교표와 담당자 비밀번호는 파일이 아니라 [⚙ 프로젝트 설정 → 스크립트 속성]에 저장됩니다. 그래서 사본에 딸려가지 않고, 학교마다 각자 넣게 됩니다.'],
    ['gap', ''],
    ['sub', '자유롭게 쓰시고 고치셔도 됩니다. 다른 학교에도 나눠주세요.'],
    ['sub', '이 안내 시트는 지우셔도 프로그램 동작에는 영향이 없습니다.']
  ];
}

/* 종류별 서식표. rule은 왼쪽 색 띠, height는 지정한 것만 고정한다. */
const GUIDE_STYLE = {
  title:  { size: 20, weight: 'bold',   color: '#14346e', bg: null,      height: 54 },
  sub:    { size: 11, weight: 'normal', color: '#5b6880', bg: null },
  h:      { size: 14, weight: 'bold',   color: '#14346e', bg: '#eef3fc', height: 38, rule: '#1a4fb4' },
  p:      { size: 11, weight: 'normal', color: '#1b2437', bg: null },
  li:     { size: 11, weight: 'normal', color: '#1b2437', bg: null },
  code:   { size: 10, weight: 'normal', color: '#22355c', bg: '#f0f4fa', font: 'Consolas', valign: 'top' },
  danger: { size: 11, weight: 'bold',   color: '#b3261e', bg: '#fdf2f1', rule: '#b3261e' },
  warn:   { size: 11, weight: 'normal', color: '#8a5200', bg: '#fdf7ed', rule: '#8a5200' },
  tip:    { size: 11, weight: 'normal', color: '#14608a', bg: '#eef6fb', rule: '#14608a' },
  gap:    { size: 11, weight: 'normal', color: '#1b2437', bg: null,      height: 14 }
};

/**
 * 안내 문구에 서식을 입혀 시트를 그린다.
 *
 * ★ 줄마다 getRange().setXxx()를 부르면 안 된다. 그 호출 하나하나가
 *   구글 서버를 왕복하기 때문에, 74줄이면 수백 번 왕복이 되어 실행이
 *   10분을 넘기고 INTERNAL 오류로 죽는다. 열 전체 배열을 만들어
 *   setFontSizes/setBackgrounds처럼 한 번에 넣고, 테두리는 RangeList로
 *   묶어서 처리한다.
 */
function buildGuideSheet_(sh) {
  const C = guideContent_();
  const n = C.length;

  const vals = [], sizes = [], weights = [], colors = [], bgs = [], fonts = [], valigns = [];
  const rules = {};   // 색 → ['A5','A12',...]

  for (var i = 0; i < n; i++) {
    const kind = C[i][0];
    const st = GUIDE_STYLE[kind] || GUIDE_STYLE.p;
    vals.push([C[i][1]]);
    sizes.push([st.size]);
    weights.push([st.weight]);
    colors.push([st.color]);
    bgs.push([st.bg || '#ffffff']);
    fonts.push([st.font || 'Noto Sans KR']);
    valigns.push([st.valign || 'middle']);
    if (st.rule) {
      if (!rules[st.rule]) rules[st.rule] = [];
      rules[st.rule].push('A' + (i + 1));
    }
  }

  const all = sh.getRange(1, 1, n, 1);
  all.setValues(vals)
     .setFontSizes(sizes)
     .setFontWeights(weights)
     .setFontColors(colors)
     .setBackgrounds(bgs)
     .setFontFamilies(fonts)
     .setVerticalAlignments(valigns)
     .setWrap(true);

  Object.keys(rules).forEach(function (color) {
    sh.getRangeList(rules[color]).setBorder(
      null, true, null, null, null, null, color, SpreadsheetApp.BorderStyle.SOLID_THICK);
  });

  sh.setColumnWidth(1, 860);
  if (sh.getMaxColumns() > 1) sh.hideColumns(2, sh.getMaxColumns() - 1);
  try { sh.setHiddenGridlines(true); } catch (e) { /* 구버전 대비 */ }

  // 높이를 지정한 종류만. 연속 구간은 묶어서 호출 수를 줄인다.
  for (var j = 0; j < n; ) {
    const h = (GUIDE_STYLE[C[j][0]] || {}).height;
    if (!h) { j++; continue; }
    var k = j;
    while (k + 1 < n && (GUIDE_STYLE[C[k + 1][0]] || {}).height === h) k++;
    sh.setRowHeights(j + 1, k - j + 1, h);
    j = k + 1;
  }

  sh.setFrozenRows(1);
}

/* ===================== 유틸 ===================== */
/**
 * 이 스크립트가 붙어 있는 스프레드시트만 연다.
 *
 * 예전에는 클라이언트가 보낸 sheetId를 그대로 openById()에 넘겼다.
 * 웹앱은 '실행: 나'로 배포되므로, 등록 링크를 가진 사람이 임의의 시트 ID를
 * 보내면 소유자 권한으로 남의 시트에 행을 쓸 수 있었다.
 * 실제로는 어떤 화면도 sheetId를 보내지 않았으므로(공격 표면일 뿐이었으므로)
 * 경로 자체를 제거했다.
 */
function openSpreadsheet_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error('이 스크립트는 스프레드시트에 연결되어 있어야 합니다. '
      + '등록부 스프레드시트에서 [확장 프로그램 → Apps Script]로 열어 배포하세요.');
  }
  return active;
}

function sheetNameFor_(title) {
  const name = (title || '등록부').replace(/[\\\/\?\*\[\]:]/g, ' ').trim().slice(0, 90);
  return name || '등록부';
}

function getWebAppUrl_() {
  try { return ScriptApp.getService().getUrl(); }
  catch (err) { return ''; }
}

function encodeList_(list) {
  const arr = Array.isArray(list) ? list : String(list).split(',');
  const csv = arr.map(function (s) { return String(s).trim(); }).filter(String).join(',');
  return Utilities.base64EncodeWebSafe(csv, Utilities.Charset.UTF_8);
}

function encodeRaw_(list) {
  const arr = Array.isArray(list) ? list : String(list).split(',');
  const csv = arr.map(function (s) { return String(s == null ? '' : s).trim(); }).join(',');
  return Utilities.base64EncodeWebSafe(csv, Utilities.Charset.UTF_8);
}

/** base64(web-safe/표준/공백→'+' 복원) 디코드 → 문자열, 실패 시 null */
function decodeB64_(v) {
  var s = String(v).trim();
  var cands = [s, s.replace(/ /g, '+')];
  for (var i = 0; i < cands.length; i++) {
    try {
      var o = Utilities.newBlob(Utilities.base64DecodeWebSafe(cands[i], Utilities.Charset.UTF_8)).getDataAsString('UTF-8');
      if (looksDecoded_(o)) return o;
    } catch (e1) { /* try next */ }
    try {
      var o2 = Utilities.newBlob(Utilities.base64Decode(cands[i], Utilities.Charset.UTF_8)).getDataAsString('UTF-8');
      if (looksDecoded_(o2)) return o2;
    } catch (e2) { /* try next */ }
  }
  return null;
}

/**
 * 디코드 결과가 '진짜 글자'로 보이는지.
 *
 * ★ 예전에는 공백이 있으면 실패로 판정했다(o.indexOf(' ') === -1).
 *   그래서 '개인정보 보호 연수'처럼 띄어쓰기가 들어간 연수명은 디코드
 *   결과를 버리고 base64 원문을 화면에 그대로 뿌렸다. 공백 없는 이름만
 *   멀쩡해 보여서 오래 눈에 안 띄었다.
 *
 *   원래 의도는 base64가 아닌 값을 억지로 디코드했을 때 나오는 깨진 문자
 *   (U+FFFD)를 걸러내는 것이었다. 그것만 본다.
 *
 *   ★ 반드시 '�' 이스케이프로 쓸 것. 그 글자를 코드에 직접 넣으면
 *     복사·붙여넣기 과정에서 공백이나 물음표로 변질되어, 검사가 조용히
 *     '공백 검사'로 바뀐다. 그러면 띄어쓰기가 든 이름이 전부 깨진다.
 *     원래 버그도 이렇게 생긴 것으로 보인다.
 */
function looksDecoded_(o) {
  return !!o && o.indexOf('\uFFFD') === -1;
}

function decodeRaw_(v) {
  if (!v) return [];
  var d = decodeB64_(v);
  var s = (d !== null) ? d : String(v);
  return s.split(',').map(function (x) { return x.trim(); });
}

function decodeList_(v) {
  if (!v) return null;
  var d = decodeB64_(v);
  var s = (d !== null) ? d : String(v);
  const arr = s.split(',').map(function (x) { return x.trim(); }).filter(String);
  return arr.length ? arr : null;
}
