-- 在 Supabase SQL Editor 执行本文件，用于创建“每用户知识图谱”表结构。
-- 注意：这里给的是最小可用 schema。若你要更严格的权限，请再收紧 RLS 策略。

create table if not exists public.user_concepts (
  user_id text not null,
  concept_id text not null,
  name text not null,
  level int,
  last_seen_at timestamptz,
  last_practice_at timestamptz,
  mastery_score double precision,
  updated_at timestamptz not null default now(),
  primary key (user_id, concept_id)
);

create table if not exists public.user_edges (
  user_id text not null,
  source_id text not null,
  target_id text not null,
  type text not null default 'PREREQ',
  updated_at timestamptz not null default now(),
  primary key (user_id, source_id, target_id, type)
);

-- 允许匿名 key 访问（你现在给的是 publishable key）
alter table public.user_concepts enable row level security;
alter table public.user_edges enable row level security;

-- 最小可用：允许任何人读写（开发期方便，但生产环境不推荐）
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_concepts' and policyname='dev_open_access') then
    create policy dev_open_access on public.user_concepts for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_edges' and policyname='dev_open_access') then
    create policy dev_open_access on public.user_edges for all using (true) with check (true);
  end if;
end$$;

