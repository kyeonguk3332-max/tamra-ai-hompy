// 탐라 AI 홈피 · 내장 도구 정기 점검
// 사용: node tools/health_check.mjs [index.html]
// - index.html 안의 EXT_TOOLS(AI 도구 탭 내장 도구)와 MK_KIT(재료 창고)를 읽어
//   ① 웹 주소가 열리는지 ② 깃허브 저장소가 남아 있는지, 마지막 커밋이 언제인지 확인한다.
// - 결과는 index.html의 <script type="application/json" id="tool-health"> 한 곳에만 쓴다.
// - 한 번 실패로는 「주의」, 두 번 연속 실패해야 「사용 중지」로 바꾼다 (일시 장애로 멀쩡한 도구를 막지 않으려고).
// - 공공 깃랩(gitlab.aigov.go.kr)처럼 밖에서 확인할 수 없는 곳은 실패로 세지 않고 「확인 못 함」으로 둔다.
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const FILE = process.argv[2] || 'index.html';
const STALE_DAYS = 365;              // 마지막 커밋이 이보다 오래되면 「주의」
const UNCHECKABLE = [/^https:\/\/gitlab\.aigov\.go\.kr\//]; // 밖에서 확인 불가
const html = fs.readFileSync(FILE, 'utf8');

function sliceArray(startMarker, endRe) {
  const a = html.indexOf(startMarker);
  if (a < 0) throw new Error('못 찾음: ' + startMarker);
  const rest = html.slice(a + startMarker.length - 1);
  const m = rest.match(endRe);
  if (!m) throw new Error('끝을 못 찾음: ' + startMarker);
  return vm.runInNewContext('(' + rest.slice(0, m.index + 2) + ')', {});
}
const EXT = sliceArray('const EXT_TOOLS=[', /\n\]\.map\(t=>/);
const KIT = sliceArray('const MK_KIT=[', /\n\];/);

const items = [];
EXT.forEach(t => items.push({ id: t.id, name: t.name, web: t.url || '', repo: (t.part && t.part.src) || '' }));
KIT.forEach(x => items.push({ id: 'kit-' + x.id, name: x.name, web: '', repo: x.url || '' }));

function sh(cmd, args, timeout = 30000) {
  try { return { ok: true, out: execFileSync(cmd, args, { timeout, stdio: ['ignore', 'pipe', 'pipe'] }).toString() }; }
  catch (e) { return { ok: false, out: String((e.stdout || '') + (e.stderr || '')) }; }
}
function checkWeb(url) {
  if (!url) return null;
  if (UNCHECKABLE.some(r => r.test(url))) return { st: 'unknown' };
  const r = sh('curl', ['-s', '-o', '/dev/null', '-L', '--max-redirs', '6', '-m', '25', '-A', 'Mozilla/5.0 (tamra-ai-hompy health check)', '-w', '%{http_code}', url], 40000);
  const code = parseInt((r.out || '').trim().slice(-3), 10) || 0;
  // 401·403은 로그인·봇 차단일 수 있어 살아 있는 것으로 본다
  return { st: code && (code < 400 || code === 401 || code === 403) ? 'ok' : 'fail', code };
}
function checkRepo(url) {
  if (!url) return null;
  if (UNCHECKABLE.some(r => r.test(url))) return { st: 'unknown' };
  if (!/^https:\/\/(github\.com|gitlab\.com)\//.test(url)) return null;
  const clean = url.replace(/\/+$/, '').replace(/\.git$/, '');
  const ls = sh('git', ['ls-remote', clean, 'HEAD'], 40000);
  if (!ls.ok || !ls.out.trim()) return { st: 'fail' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-'));
  let last = '';
  try {
    sh('git', ['init', '-q', dir]);
    const f = sh('git', ['-C', dir, 'fetch', '-q', '--depth', '1', '--filter=blob:none', clean, 'HEAD'], 90000);
    if (f.ok) { const l = sh('git', ['-C', dir, 'log', '-1', '--format=%cI', 'FETCH_HEAD']); if (l.ok) last = l.out.trim(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  return { st: 'ok', last };
}

const prevM = html.match(/<script type="application\/json" id="tool-health">([\s\S]*?)<\/script>/);
let prev = { items: {} };
try { if (prevM) prev = JSON.parse(prevM[1]); } catch (e) {}
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const out = { checked: today, staleDays: STALE_DAYS, items: {} };
const report = [];

for (const it of items) {
  const p = (prev.items || {})[it.id] || {};
  const w = checkWeb(it.web), r = checkRepo(it.repo);
  const webFail = w ? (w.st === 'fail' ? (p.webFail || 0) + 1 : 0) : 0;
  const repoFail = r ? (r.st === 'fail' ? (p.repoFail || 0) + 1 : 0) : 0;
  let days = null;
  if (r && r.last) days = Math.floor((Date.now() - Date.parse(r.last)) / 86400000);
  let st = 'ok', note = '';
  if (webFail >= 2 || repoFail >= 2) { st = 'dead'; note = webFail >= 2 ? `두 번 연속 점검에서 열리지 않았어요 (응답 ${w.code || '없음'})` : '두 번 연속 점검에서 원본 저장소를 찾지 못했어요 (삭제·비공개 전환 가능)'; }
  else if (webFail === 1) { st = 'warn'; note = `이번 점검에서 열리지 않았어요 (응답 ${w.code || '없음'}). 다음 점검에서도 안 열리면 사용 중지로 바뀌어요`; }
  else if (repoFail === 1) { st = 'warn'; note = '이번 점검에서 원본 저장소를 찾지 못했어요. 다음 점검에서도 없으면 사용 중지로 바뀌어요'; }
  else if (days !== null && days > STALE_DAYS) { st = 'warn'; note = `원본이 ${Math.floor(days / 30)}개월째 업데이트가 없어요 (유지관리가 멈췄을 수 있어요)`; }
  else if ((w && w.st === 'unknown') || (r && r.st === 'unknown' && !w)) { st = 'unknown'; note = '밖에서 확인할 수 없는 곳이라 자동 점검을 못 했어요 (공공 깃랩 등)'; }
  const rec = { st, note, webFail, repoFail };
  if (w && w.code) rec.code = w.code;
  if (r && r.last) rec.last = r.last.slice(0, 10);
  out.items[it.id] = rec;
  if (st !== (p.st || 'ok') || st !== 'ok') report.push(`- ${st === 'dead' ? '⛔' : st === 'warn' ? '⚠' : st === 'unknown' ? '❔' : '✔'} ${it.name} (${it.id}): ${(p.st || '처음') + ' → ' + st}${note ? ' · ' + note : ''}`);
}

const json = JSON.stringify(out).replace(/</g, '\\u003c');
const tag = `<script type="application/json" id="tool-health">${json}</script>`;
let next;
if (prevM) next = html.replace(prevM[0], tag);
else throw new Error('index.html에 tool-health 칸이 없어요');
fs.writeFileSync(FILE, next);

const cnt = s => Object.values(out.items).filter(x => x.st === s).length;
console.log(`점검일 ${today} · 전체 ${items.length} · 정상 ${cnt('ok')} · 주의 ${cnt('warn')} · 사용 중지 ${cnt('dead')} · 확인 못 함 ${cnt('unknown')}`);
const changed = Object.keys(out.items).filter(k => ((prev.items || {})[k] || {}).st !== out.items[k].st);
console.log(`상태가 바뀐 도구: ${changed.length}개`);
if (report.length) console.log(report.join('\n'));
