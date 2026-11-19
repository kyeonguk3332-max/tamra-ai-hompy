// 탐라 AI 홈피 · 파츠 점검기
// 사용: node tools/parts_check.mjs [index.html]
// 파츠(고쳐 쓰기 재료)를 새로 넣거나 고친 뒤 꼭 돌려요. 오류가 하나라도 있으면 종료 코드 1로 끝나요.
// 공공 깃랩이 열려 파츠가 수십~수백 개로 늘어날 때를 대비해, 사람이 하나하나 보지 않아도 걸러지게 만든 검사예요.
//
// 검사하는 것
//  [오류] 틀 유형(type)이 없거나 PART_TYPES에 없음 · 판정 틀(skel)과 유형이 안 맞음
//  [오류] 추천 업무(fits)가 0개이거나 6개 넘음 · 60자 넘음 · 같은 파츠 안에서 겹침 · 다른 파츠와 똑같이 겹침
//  [오류] frame(틀 설명)의 “○○형”이 type과 다름 · swap(바꿔 끼울 부분)이 비어 있음
//  [오류] 페이지 스크립트 안에 '<!--'나 '<script' 글자가 그대로 있음 (브라우저가 스크립트 끝을 잘못 읽어 홈피 전체가 멈춰요)
//  [오류] SKELS(판정 틀 목록)를 읽을 수 없거나, 파츠가 쓰는 판정 틀 파일이 페이지에 없음
//  [주의] 공개 라이선스 원본인데 명세서(spec)가 없음 → AI가 원본 링크를 직접 읽어야 해요
//  [주의] 추천 업무가 3개보다 적음 · 예시 문구(ex)가 없음
import fs from 'node:fs';
import vm from 'node:vm';

const FILE = process.argv[2] || 'index.html';
const html = fs.readFileSync(FILE, 'utf8');
const errors = [], warns = [];
const err = (w, m) => errors.push(`✖ [${w}] ${m}`), warn = (w, m) => warns.push(`△ [${w}] ${m}`);

function slice(startMarker, endRe) {
  const a = html.indexOf(startMarker);
  if (a < 0) throw new Error('못 찾음: ' + startMarker);
  const rest = html.slice(a + startMarker.length - 1);
  const m = rest.match(endRe);
  if (!m) throw new Error('끝을 못 찾음: ' + startMarker);
  const close = m.index + m[0].search(/[\]}]/) + 1; // 끝 표시 안의 닫는 괄호까지
  return vm.runInNewContext('(' + rest.slice(0, close) + ')', {});
}
const EXT = slice('const EXT_TOOLS=[', /\n\]\.map\(t=>/);
const KIT = slice('const MK_KIT=[', /\n\];/);
const TYPES = slice('const PART_TYPES={', /\n\};/);
const LIC_OK = slice('const LIC_OK=[', /\]/);
let SKELS = {};
try { const a = html.indexOf('const SKELS='), b = html.indexOf('\n', a); SKELS = JSON.parse(html.slice(a + 12, b).trim().replace(/;$/, '')); }
catch (e) { err('SKELS', '판정 틀 목록(SKELS)을 읽을 수 없어요: ' + e.message); }
for (const [k, S] of Object.entries(SKELS)) if (!html.includes(`id="${S.id}"`)) err('SKELS', `판정 틀 「${k}」의 파일(${S.id})이 페이지에 없어요.`);

// 1) 스크립트 안전: 큰 인라인 스크립트에 '<!--' 또는 '<script'가 그대로 있으면 HTML 파서가 스크립트 끝을 놓친다
{
  const m = html.match(/<script>\n\(function\(\)\{[\s\S]*?\n\}\)\(\);\n<\/script>/);
  if (!m) warn('스크립트', '본 스크립트 위치를 찾지 못해 안전 검사를 건너뛰었어요.');
  else for (const x of m[0].slice(8, -9).matchAll(/<!--|<script/gi))
    err('스크립트', `본 스크립트 ${x.index}번째 글자에 「${x[0]}」가 그대로 있어요. '\\x3c!--'·'\\x3cscript'처럼 바꿔 쓰세요.`);
}

// 2) 파츠 하나하나
const parts = [
  ...EXT.filter(t => t.part).map(t => ({ where: t.id, name: t.name, p: t.part })),
  ...KIT.filter(x => x.part).map(x => ({ where: 'kit-' + x.id, name: x.name, p: x.part }))
];
const norm = (t) => String(t).replace(/[\s·,()（）\-]/g, '');
const seen = new Map();
for (const { where, name, p } of parts) {
  const T = TYPES[p.type];
  if (!p.type) err(where, `틀 유형(type)이 없어요. PART_TYPES 중 하나를 붙여 주세요: ${Object.keys(TYPES).join(', ')}`);
  else if (!T) err(where, `모르는 틀 유형 「${p.type}」이에요.`);
  const q = /“([^”]+)”/.exec(p.frame || '');
  if (!p.frame) err(where, 'frame(틀 설명)이 없어요.');
  else if (T && q && !T.label.startsWith(q[1].replace(/ \(.*$/, '')) && !q[1].startsWith(T.label.replace(/ \(.*$/, '')))
    err(where, `frame의 「${q[1]}」과 type 「${T.label}」이 달라요.`);
  if (p.skel) {
    if (!SKELS[p.skel]) err(where, `없는 판정 틀 「${p.skel}」을 써요.`);
    if (T && T.skel !== p.skel) err(where, `판정 틀 「${p.skel}」은 「${T.label}」 유형과 안 맞아요.`);
  }
  if (!Array.isArray(p.swap) || !p.swap.length) err(where, 'swap(우리 기준으로 바꿔 끼울 부분)이 비어 있어요.');
  if (!p.ex) warn(where, 'ex(② 칸 예시 문구)가 없어요.');
  const fits = Array.isArray(p.fits) ? p.fits : [];
  if (!fits.length) err(where, '추천 업무(fits)가 없어요. 틀과 동작 방식이 같은 실제 업무로 3~5개 넣어 주세요.');
  if (fits.length > 6) err(where, `추천 업무가 ${fits.length}개예요. 6개까지만 보여요.`);
  if (fits.length && fits.length < 3) warn(where, `추천 업무가 ${fits.length}개뿐이에요. 조건에 맞는 업무가 더 없으면 그대로 둬도 돼요.`);
  const inPart = new Set();
  for (const f of fits) {
    if (String(f).length > 60) err(where, `추천 업무가 60자를 넘어요: ${f}`);
    const k = norm(f);
    if (inPart.has(k)) err(where, `추천 업무가 겹쳐요: ${f}`); inPart.add(k);
    if (seen.has(k)) err(where, `「${f}」가 ${seen.get(k)}에도 있어요. 파츠마다 그 틀에 가장 맞는 업무만 남기세요.`);
    else seen.set(k, where);
  }
  if (p.src && LIC_OK.includes(p.lic) && !p.spec && !(T && T.skel))
    warn(where, `공개 라이선스(${p.lic}) 원본인데 명세서(spec)가 없어요. 원본 코드를 읽고 명세서를 써 두면 직원이 아무것도 붙여 넣지 않아도 돼요.`);
}

// 3) 유형 기본 추천 업무도 같은 기준으로
for (const [k, T] of Object.entries(TYPES)) {
  if (!T.label) err('PART_TYPES.' + k, 'label이 없어요.');
  if (!Array.isArray(T.fits) || !T.fits.length) err('PART_TYPES.' + k, '유형 기본 추천 업무(fits)가 없어요.');
  (T.fits || []).forEach(f => { if (String(f).length > 60) err('PART_TYPES.' + k, `60자를 넘어요: ${f}`); });
  if (T.skel && !SKELS[T.skel]) err('PART_TYPES.' + k, `없는 판정 틀 「${T.skel}」.`);
}

const byType = {};
parts.forEach(({ p }) => { byType[p.type || '(없음)'] = (byType[p.type || '(없음)'] || 0) + 1; });
console.log(`파츠 ${parts.length}개 · 유형별 ${Object.entries(byType).map(([k, v]) => `${(TYPES[k] || { label: k }).label} ${v}`).join(', ')}`);
warns.forEach(w => console.log(w));
errors.forEach(e => console.log(e));
console.log(errors.length ? `\n오류 ${errors.length}개 — 고친 뒤 다시 돌려 주세요.` : `\n오류 없음 (주의 ${warns.length}개).`);
process.exit(errors.length ? 1 : 0);
