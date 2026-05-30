-- Initial Polyphonia sharing schema.
--
-- This is the schema expected by the app before artist identities were split
-- out into their own table. Run this first for a fresh Supabase project.

insert into storage.buckets (id, name, public)
values ('stems', 'stems', true)
on conflict (id) do update set public = excluded.public;

create table if not exists public.compositions (
  id text primary key,
  manifest jsonb not null,
  owner uuid not null references auth.users(id),
  title text not null,
  artist text not null,
  created_at timestamptz default now()
);

alter table public.compositions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'compositions'
      and policyname = 'public read compositions'
  ) then
    create policy "public read compositions" on public.compositions
      for select to anon, authenticated using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'compositions'
      and policyname = 'owners insert compositions'
  ) then
    create policy "owners insert compositions" on public.compositions
      for insert to authenticated with check (owner = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'compositions'
      and policyname = 'owners update compositions'
  ) then
    create policy "owners update compositions" on public.compositions
      for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'compositions'
      and policyname = 'owners delete compositions'
  ) then
    create policy "owners delete compositions" on public.compositions
      for delete to authenticated using (owner = auth.uid());
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'public read stems'
  ) then
    create policy "public read stems" on storage.objects
      for select to anon, authenticated using (bucket_id = 'stems');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'owners upload stems'
  ) then
    create policy "owners upload stems" on storage.objects
      for insert to authenticated with check (bucket_id = 'stems');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'owners update stems'
  ) then
    create policy "owners update stems" on storage.objects
      for update to authenticated using (bucket_id = 'stems') with check (bucket_id = 'stems');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'owners delete stems'
  ) then
    create policy "owners delete stems" on storage.objects
      for delete to authenticated using (bucket_id = 'stems');
  end if;
end
$$;
