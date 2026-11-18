# 탐라 AI 홈피 — 웹(Vercel + Supabase) 배포 안내

화면 파일은 `index.html` 하나입니다. Claude 아티팩트와 같은 파일이라, 아티팩트를 고치면 이 파일도 같이 바뀌고 GitHub에 올리면 Vercel이 자동으로 다시 배포합니다.

- Claude 아티팩트에서 열면 → Claude 저장소를 씀 (로그인 창 없음)
- Vercel 주소로 열면 → 로그인/회원가입 후 Supabase에 저장 (PC·폰 어디서든 같은 계정)

## 1. Supabase (한 번만, 약 10분)

1. supabase.com 가입 → **New project** (지역: Northeast Asia (Seoul)). DB 비밀번호는 따로 메모.
2. 왼쪽 **SQL Editor** → `1_supabase_setup.sql` 내용을 붙여넣고 **Run** → 이어서 `2_import_old_data.sql` 도 **Run**.
   - 1번: 표·보안 규칙·가입 코드(`jejusiai`)·마스터(`ku3332`) 설정
   - 2번: 아티팩트에서 쓰던 내 캐릭터·방·귤·샘플 도구 옮기기 (ku3332로 처음 가입하는 순간 자동으로 내 것이 됨)
3. **Authentication → Sign In / Providers → Email** → **Confirm email 끄기** (메일 인증 없이 아이디로 가입하기 때문)
4. **Authentication → Rate Limits** → 가입·로그인 한도를 넉넉히 (같은 청사 인터넷은 하나의 주소로 보여서 한꺼번에 가입하면 막힐 수 있음)
5. **Project Settings → API Keys** 에서 두 값을 복사해 Claude에게 전달
   - Project URL (`https://xxxx.supabase.co`)
   - **anon / publishable** 키 (공개돼도 되는 키). ⚠️ `service_role`/`secret` 키는 절대 전달·게시 금지

> 무료 요금제는 7일 동안 아무도 접속하지 않으면 잠듭니다. 대시보드에서 **Restore** 누르면 다시 깨어나요.

## 2. GitHub

- 새 저장소(예: `tamra-ai-hompy`) 생성 → Claude가 `index.html`을 올리고, 이후 수정 때마다 자동으로 올립니다.

## 3. Vercel (한 번만, 약 3분)

1. vercel.com → GitHub 계정으로 로그인
2. **Add New → Project** → 위 저장소 **Import**
3. Framework Preset: **Other**, Build 설정은 비워 둔 채 **Deploy**
4. 나온 주소(`https://xxx.vercel.app`)를 직원들에게 공유 + 가입 코드 안내

## 운영

- 처음 접속 → **회원가입** 탭 → 아이디 / 비밀번호 / 가입 코드
- 마스터(ku3332)는 왼쪽 위젯의 **👑 마스터 메뉴**에서
  - 가입 코드 바꾸기 (밖으로 퍼졌을 때. 기존 회원은 영향 없음)
  - 비밀번호 잊은 직원에게 임시 비밀번호 만들어 주기
  - 가입 인원 확인
- 아티팩트의 '비밀 다이어리'는 개인 비공개 저장소라 옮겨지지 않습니다.
- 업무망 PC에서 vercel.app·supabase.co가 막혀 있으면 접속이 안 될 수 있어요 (인터넷망 PC·폰은 정상).

## 내장 도구 정기 점검

AI 도구 탭의 내장 도구(`EXT_TOOLS`)와 AI공방 재료 창고(`MK_KIT`)가 아직 살아 있는지 점검합니다.

```
node tools/health_check.mjs index.html
```

- 웹 주소가 열리는지, 깃허브 원본 저장소가 남아 있는지, 마지막 커밋이 언제인지 봅니다.
- 결과는 `index.html` 안의 `<script id="tool-health">` 한 줄에만 써요. 화면은 이 값으로 도구 카드에 점검 표시를 붙입니다.
- 판정: 한 번 안 열리면 **⚠ 주의**, 두 번 연속 안 열리면 **⛔ 사용 중지**(열기 버튼이 막히고 목록 맨 뒤로, 도구 찾기에서 빠짐). 원본이 1년 넘게 업데이트가 없으면 **⚠ 주의**.
- 공공 깃랩(gitlab.aigov.go.kr)처럼 밖에서 확인할 수 없는 곳은 실패로 세지 않습니다.
- 직원이 화면에서 직접 올린 도구는 이 점검 대상이 아니에요(후기의 「고장 신고」로 표시됩니다).
