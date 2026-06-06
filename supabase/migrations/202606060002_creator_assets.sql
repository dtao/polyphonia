create table if not exists public.creator_assets (
  id text primary key,
  owner uuid not null references auth.users(id) on delete cascade,
  manifest jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.creator_assets enable row level security;

create policy "public read creator assets" on public.creator_assets
  for select using (true);

create policy "owners insert creator assets" on public.creator_assets
  for insert to authenticated with check (owner = auth.uid());

create policy "owners update creator assets" on public.creator_assets
  for update to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid());

create policy "owners delete creator assets" on public.creator_assets
  for delete to authenticated using (owner = auth.uid());
