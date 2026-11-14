-- =====================================================================
-- 탐라 AI 홈피 · Supabase 설정 (1/2)
-- 사용법: Supabase 대시보드 → SQL Editor → New query → 이 파일 내용을 통째로 붙여 넣고 Run
-- 여러 번 실행해도 안전하게 만들었어요.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 1. 표
--   docs         : 홈피의 모든 공유 기록 (캐릭터·미니룸·도구·요청·꿀팁·후기·방명록)
--   private_docs : 나만 읽는 기록 (비밀 다이어리)
--   app_settings : 가입 코드 같은 설정 (직원 화면에서는 안 보임)
--   app_admins   : 마스터 아이디
--   seed_import  : 예전(Claude 아티팩트) 기록을 새 아이디로 이어받기 위한 보관함
-- ---------------------------------------------------------------------
create table if not exists public.docs (
  col        text        not null,
  id         text        not null,
  data       jsonb       not null default '{}'::jsonb,
  owner      uuid        references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (col, id),
  constraint docs_col_ok  check (col in ('chars','rooms','tools','guestbook','requests','tips','reviews')),
  constraint docs_id_ok   check (char_length(id) between 1 and 200),
  constraint docs_size_ok check (pg_column_size(data) < 262144)
);

create table if not exists public.private_docs (
  owner      uuid        not null references auth.users(id) on delete cascade,
  key        text        not null,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner, key),
  constraint private_size_ok check (pg_column_size(data) < 262144)
);

create table if not exists public.app_settings (key text primary key, value text not null);
create table if not exists public.app_admins   (username text primary key);
create table if not exists public.seed_import  (
  username   text primary key,
  old_uid    text not null,
  docs       jsonb not null,
  claimed_at timestamptz
);

alter table public.docs         enable row level security;
alter table public.private_docs enable row level security;
alter table public.app_settings enable row level security;   -- 정책 없음 = 직원 화면에서 접근 불가
alter table public.app_admins   enable row level security;
alter table public.seed_import  enable row level security;

-- ---------------------------------------------------------------------
-- 2. 도우미 함수
--   아이디는 로그인 이메일(아이디@tamra.example.com)의 앞부분에서 읽어요.
--   (사용자가 직접 바꿀 수 있는 user_metadata는 믿지 않아요)
-- ---------------------------------------------------------------------
create or replace function public.app_username()
returns text language sql stable security definer set search_path = public, auth as $$
  select split_part(email, '@', 1) from auth.users where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from public.app_admins a where a.username = public.app_username())
$$;

-- ---------------------------------------------------------------------
-- 3. 권한 (RLS)
--   읽기: 로그인한 직원 모두
--   쓰기: 캐릭터·미니룸은 본인 것만 / 나머지는 쓴 사람 본인
--         단, 도구 요청(손 들기)과 꿀팁(좋아요)은 다른 직원도 고칠 수 있어요
--   지우기: 쓴 사람 본인 또는 마스터
-- ---------------------------------------------------------------------
drop policy if exists docs_read   on public.docs;
drop policy if exists docs_insert on public.docs;
drop policy if exists docs_update on public.docs;
drop policy if exists docs_delete on public.docs;

create policy docs_read on public.docs for select to authenticated using (true);

create policy docs_insert on public.docs for insert to authenticated with check (
  owner = auth.uid()
  and (col not in ('chars','rooms') or id = auth.uid()::text)
);

create policy docs_update on public.docs for update to authenticated
  using (owner = auth.uid() or public.is_admin() or col in ('requests','tips'))
  with check (col not in ('chars','rooms') or id = auth.uid()::text or public.is_admin());

create policy docs_delete on public.docs for delete to authenticated
  using (owner = auth.uid() or public.is_admin());

drop policy if exists private_rw on public.private_docs;
create policy private_rw on public.private_docs for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

-- 고칠 때 주인·분류·번호는 못 바꾸게
create or replace function public.docs_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  new.owner := old.owner;
  new.col := old.col;
  new.id := old.id;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists docs_guard on public.docs;
create trigger docs_guard before update on public.docs for each row execute function public.docs_guard();

-- 일부 칸만 고치기 (예: 귤 개수만 바꾸기). 권한 검사는 위 RLS가 그대로 적용돼요.
create or replace function public.merge_doc(p_col text, p_id text, p_patch jsonb)
returns jsonb language sql security invoker set search_path = public as $$
  update public.docs set data = data || coalesce(p_patch, '{}'::jsonb)
  where col = p_col and id = p_id
  returning data
$$;

-- ---------------------------------------------------------------------
-- 4. 가입 코드 검사 (서버에서 검사하므로 화면 코드를 봐도 우회 불가)
-- ---------------------------------------------------------------------
create or replace function public.check_signup()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  select value into v_code from public.app_settings where key = 'signup_code';
  if v_code is null or coalesce(new.raw_user_meta_data->>'code', '') <> v_code then
    raise exception 'invalid_signup_code';
  end if;
  if new.email !~ '^[a-z0-9_]{3,20}@tamra\.example\.com$' then
    raise exception 'invalid_username';
  end if;
  -- 가입 코드는 저장하지 않고 지워요
  new.raw_user_meta_data := (coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'code')
                            || jsonb_build_object('username', split_part(new.email, '@', 1));
  return new;
end $$;
drop trigger if exists tamra_check_signup on auth.users;
create trigger tamra_check_signup before insert on auth.users for each row execute function public.check_signup();

-- ---------------------------------------------------------------------
-- 5. 예전 기록 이어받기: 해당 아이디로 처음 로그인하면 한 번만 실행돼요
-- ---------------------------------------------------------------------
create or replace function public.claim_seed()
returns integer language plpgsql security definer set search_path = public, auth as $$
declare
  s record; d jsonb; n integer := 0;
  v_user text := public.app_username();
  v_me   text := auth.uid()::text;
begin
  if auth.uid() is null or v_user is null then return 0; end if;
  select * into s from public.seed_import where username = v_user and claimed_at is null for update;
  if not found then return 0; end if;
  for d in select value from jsonb_array_elements(replace(s.docs::text, s.old_uid, v_me)::jsonb) loop
    insert into public.docs (col, id, data, owner)
    values (d->>'col', d->>'id', d->'data', auth.uid())
    on conflict (col, id) do nothing;
    n := n + 1;
  end loop;
  update public.seed_import set claimed_at = now() where username = v_user;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 6. 마스터 기능
-- ---------------------------------------------------------------------
create or replace function public.admin_set_signup_code(p_code text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  if char_length(trim(coalesce(p_code, ''))) < 4 then raise exception 'short_code'; end if;
  insert into public.app_settings (key, value) values ('signup_code', trim(p_code))
  on conflict (key) do update set value = excluded.value;
  return true;
end $$;

create or replace function public.admin_reset_password(p_username text, p_password text)
returns boolean language plpgsql security definer set search_path = public, auth, extensions as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  if char_length(coalesce(p_password, '')) < 6 then raise exception 'short_password'; end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         updated_at = now()
   where email = lower(trim(p_username)) || '@tamra.example.com';
  return found;
end $$;

create or replace function public.admin_member_count()
returns integer language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  return (select count(*) from auth.users where email like '%@tamra.example.com');
end $$;

-- ---------------------------------------------------------------------
-- 7. 접근 권한 정리 (로그인 안 한 사람은 아무것도 못 함)
-- ---------------------------------------------------------------------
revoke all on public.docs, public.private_docs, public.app_settings, public.app_admins, public.seed_import from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.docs to authenticated;
grant select, insert, update, delete on public.private_docs to authenticated;

revoke all on function public.app_username(), public.is_admin(), public.merge_doc(text,text,jsonb),
  public.claim_seed(), public.admin_set_signup_code(text), public.admin_reset_password(text,text),
  public.admin_member_count(), public.check_signup(), public.docs_guard() from public, anon;
grant execute on function public.app_username(), public.is_admin(), public.merge_doc(text,text,jsonb),
  public.claim_seed(), public.admin_set_signup_code(text), public.admin_reset_password(text,text),
  public.admin_member_count() to authenticated;

-- ---------------------------------------------------------------------
-- 8. 실시간 반영 (다른 직원의 변화가 바로 보이게)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'docs') then
    execute 'alter publication supabase_realtime add table public.docs';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 9. 기본 설정: 가입 코드, 마스터
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value) values ('signup_code', 'jejusiai')
on conflict (key) do nothing;
insert into public.app_admins (username) values ('ku3332') on conflict do nothing;
