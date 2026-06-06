-- Creator-owned immutable detail-pack manifests and binary assets.

insert into storage.buckets (id, name, public)
values ('environment-assets', 'environment-assets', true)
on conflict (id) do update set public = excluded.public;

create table if not exists public.detail_packs (
  id text primary key,
  owner uuid not null references auth.users(id),
  manifest jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.detail_packs enable row level security;

create policy "public read detail packs" on public.detail_packs
  for select to anon, authenticated using (true);

create policy "owners insert detail packs" on public.detail_packs
  for insert to authenticated with check (owner = auth.uid());

create policy "owners update detail packs" on public.detail_packs
  for update to authenticated using (owner = auth.uid())
  with check (owner = auth.uid());

create policy "owners delete detail packs" on public.detail_packs
  for delete to authenticated using (owner = auth.uid());

create policy "public read environment assets" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'environment-assets');

create policy "owners upload environment assets" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'environment-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "owners update environment assets" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'environment-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'environment-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "owners delete environment assets" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'environment-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
