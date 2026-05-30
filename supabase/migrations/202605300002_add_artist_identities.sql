-- Add first-class artist identities and per-artist composition title uniqueness.
--
-- Run after 202605300001_initial_sharing.sql. If existing data has duplicate
-- normalized titles for the same owner + artist name, this migration raises a
-- clear exception before adding the unique constraint; clean/rename duplicates
-- and rerun.

create table if not exists public.artists (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id),
  name text not null,
  slug text not null unique,
  avatar_url text,
  avatar_email_hash text,
  created_at timestamptz default now(),
  unique (owner, name)
);

alter table public.artists enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'artists'
      and policyname = 'public read artists'
  ) then
    create policy "public read artists" on public.artists
      for select to anon, authenticated using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'artists'
      and policyname = 'owners insert artists'
  ) then
    create policy "owners insert artists" on public.artists
      for insert to authenticated with check (owner = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'artists'
      and policyname = 'owners update artists'
  ) then
    create policy "owners update artists" on public.artists
      for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
  end if;
end
$$;

alter table public.compositions add column if not exists artist_id uuid references public.artists(id);
alter table public.compositions add column if not exists title_key text;
alter table public.compositions add column if not exists artist_slug text;
alter table public.compositions add column if not exists artist_avatar_url text;
alter table public.compositions add column if not exists artist_avatar_email_hash text;

create or replace function public.polyphonia_slugify(input text)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(trim(input)), '[''"]', '', 'g'),
          '[^a-z0-9]+',
          '-',
          'g'
        ),
        '(^-+|-+$)',
        '',
        'g'
      ),
      ''
    ),
    'artist'
  )
$$;

create or replace function public.polyphonia_title_key(input text)
returns text
language sql
immutable
as $$
  select coalesce(nullif(regexp_replace(lower(trim(input)), '\s+', ' ', 'g'), ''), 'untitled')
$$;

update public.compositions
set
  artist = coalesce(nullif(trim(artist), ''), 'Unknown'),
  title = coalesce(nullif(trim(title), ''), 'Untitled'),
  title_key = public.polyphonia_title_key(title)
where artist is distinct from coalesce(nullif(trim(artist), ''), 'Unknown')
   or title is distinct from coalesce(nullif(trim(title), ''), 'Untitled')
   or title_key is null;

with distinct_artists as (
  select
    owner,
    artist as name,
    min(created_at) as created_at
  from public.compositions
  where artist_id is null
  group by owner, artist
),
numbered as (
  select
    owner,
    name,
    created_at,
    public.polyphonia_slugify(name) as base_slug,
    row_number() over (partition by public.polyphonia_slugify(name) order by created_at, owner::text, name) as slug_index
  from distinct_artists
),
to_insert as (
  select
    owner,
    name,
    case when slug_index = 1 then base_slug else base_slug || '-' || slug_index::text end as slug,
    created_at
  from numbered
)
insert into public.artists (owner, name, slug, created_at)
select owner, name, slug, created_at
from to_insert
on conflict (owner, name) do nothing;

update public.compositions c
set
  artist_id = a.id,
  artist_slug = a.slug,
  artist_avatar_url = a.avatar_url,
  artist_avatar_email_hash = a.avatar_email_hash,
  manifest = jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          c.manifest,
          '{artist}',
          to_jsonb(a.name),
          true
        ),
        '{artistId}',
        to_jsonb(a.id::text),
        true
      ),
      '{artistSlug}',
      to_jsonb(a.slug),
      true
    ),
    '{title}',
    to_jsonb(coalesce(nullif(trim(c.title), ''), 'Untitled')),
    true
  )
from public.artists a
where c.artist_id is null
  and a.owner = c.owner
  and a.name = c.artist;

update public.compositions c
set
  artist_slug = a.slug,
  artist_avatar_url = a.avatar_url,
  artist_avatar_email_hash = a.avatar_email_hash,
  title_key = public.polyphonia_title_key(c.title)
from public.artists a
where c.artist_id = a.id
  and (
    c.artist_slug is distinct from a.slug
    or c.artist_avatar_url is distinct from a.avatar_url
    or c.artist_avatar_email_hash is distinct from a.avatar_email_hash
    or c.title_key is null
  );

do $$
begin
  if exists (
    select 1
    from public.compositions
    group by artist_id, title_key
    having count(*) > 1
  ) then
    raise exception 'Duplicate composition titles exist for at least one artist. Resolve duplicates before adding artist title uniqueness.';
  end if;
end
$$;

alter table public.compositions alter column artist_id set not null;
alter table public.compositions alter column title_key set not null;
alter table public.compositions alter column artist_slug set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'compositions_artist_id_title_key_key'
      and conrelid = 'public.compositions'::regclass
  ) then
    alter table public.compositions
      add constraint compositions_artist_id_title_key_key unique (artist_id, title_key);
  end if;
end
$$;

drop function public.polyphonia_slugify(text);
drop function public.polyphonia_title_key(text);
