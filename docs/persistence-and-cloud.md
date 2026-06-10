# Persistence and Cloud

**Sources:** `src/persistence.ts`, `src/cloud.ts`, `src/localDatabase.ts`,
`supabase/migrations/`

Polyphonia is local-first: the app works fully offline. Cloud sharing is opt-in
and requires a Supabase project.

## Local persistence

### What goes where

| Data | Storage | Key |
|---|---|---|
| Composition manifests (JSON) | `localStorage` | `"polyphonia:library"` |
| Uploaded stem audio (binary blobs) | IndexedDB | audio asset id |
| Environment pack bundles | IndexedDB | pack id |
| Creator assets (materials, landmarks) | IndexedDB | asset id |

Manifests are small (< a few KB); audio blobs can be megabytes. localStorage
can't hold audio reliably; IndexedDB can.

### Library format

The `localStorage` entry is a versioned JSON object:

```json
{
  "version": 5,
  "library": [ /* array of SerializedComposition */ ],
  "currentId": "..."
}
```

`loadLibrary` reads and migrates this on startup. Older versions (2–4) are
handled by the same loader. The pre-library single-slot format (`"polyphonia:composition"`)
is also migrated on first run.

### Blob sources and serialization

User-uploaded stems have `source.kind === "file"` with a `blob:` URL at
runtime. Blob URLs are not serializable (they're ephemeral object URLs bound
to the current session). Before writing to localStorage, `serializeComposition`
rewrites uploaded tracks:

```ts
// Runtime:  { kind: "file", url: "blob:http://localhost/..." }
// Stored:   { kind: "stored", key: "<audioAssetId>" }
```

When loading, `resolveComposition` reads the blob back from IndexedDB and
reconstructs a fresh object URL. If IndexedDB doesn't have the blob (deleted or
storage cleared), that track is silently dropped.

**Blob URLs must be revoked when stems are deleted.** The store action
`deleteTrack` calls `revokeBlobUrls` before removing the track. Failing to
revoke leaks memory until the tab closes.

### Auto-save

The store persists the library automatically whenever the composition changes.
There is no explicit "save" action — every edit is saved immediately.

### Export / import

`exportComposition` serializes the composition plus all its IndexedDB blobs
into a self-contained `.polyphonia.json` bundle. `importComposition` unpacks
the bundle, stores blobs in IndexedDB, and adds the composition to the library.

## Cloud sharing (Supabase)

### Configuration

Cloud features require two Vite environment variables:

```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

Set these in `.env.local` for local development. For deployed builds set them
in the Netlify dashboard — Vite inlines `VITE_*` at build time so they must be
present during the build.

`isSharingConfigured` is false when either variable is missing. All cloud UI
is hidden in that case.

### Auth: email magic link

```ts
signInWithEmail(email)   // sends an OTP link; no password
signOut()
onAuthChange(callback)   // subscribe to auth state changes
getCurrentUser()         // returns the current session user
```

The app origin must be in Supabase Auth → URL Configuration → Redirect URLs,
or magic-link clicks will fail.

### Artist identity

Each signed-in user has one or more `artists` rows. On sign-in, the store loads
the user's first artist as `accountArtist` (`getAccountArtist`). If none exists,
the user can create one (`ensureArtistForCurrentUser` / `createAccountArtist`).

Cloud identity is `artistId` (UUID) + `artistSlug` (URL-safe string). Display
names can change; slugs should not. URLs use `/artist/:slug`. Compositions carry
denormalized `artist`, `artistId`, `artistSlug` fields for gallery/viewer
rendering.

### Publish flow

`publishComposition(comp, onProgress)`:

1. Assigns a stable `publishedId` (UUID) if the composition doesn't have one.
2. For each uploaded stem, computes a SHA-256 hash of the blob.
3. Skips uploading stems whose hash matches what's already stored
   (`track.hash` in the manifest).
4. Uploads changed stem blobs to the `stems` Supabase Storage bucket using the
   path `<publishedId>/<audioAssetId>`.
5. Rewrites all stem sources in the manifest to public CDN URLs.
6. Upserts the manifest into the `compositions` Postgres table (keyed by
   `publishedId`).
7. Returns the updated composition (with CDN URLs and `publishedRevision` set).

The stable `publishedId` means re-publishing keeps the same share link
(`/c/<publishedId>`). Hash-based dedup means re-publishing an unchanged
composition is a no-op for audio uploads.

### Database schema

Two tables (see `supabase/migrations/`):

**`compositions`**
- `id` — `publishedId` UUID, primary key
- `owner` — `auth.uid()` of the publisher
- `manifest` — full composition JSON
- `title_key` — normalized title for uniqueness within an artist
- `artist_id`, `artist_slug` — denormalized for gallery queries

**`artists`**
- `id` — UUID
- `owner` — `auth.uid()`
- `name`, `slug`, `avatar_url`, `avatar_email_hash`

### RLS policies

All data access goes through Row Level Security — there is no custom server.
Required policies:

| Table | `select` | `insert` | `update` | `delete` |
|---|---|---|---|---|
| `artists` | public | `owner = auth.uid()` | `owner = auth.uid()` | — |
| `compositions` | public | `owner = auth.uid()` | `owner = auth.uid()` | `owner = auth.uid()` |
| `storage.objects` (stems bucket) | public | authenticated | authenticated | authenticated |

Storage `update` is needed because re-publish overwrites stems via `upsert`.

> **"new row violates row-level security policy"** almost always means a
> missing RLS policy, not a code bug. Check the Supabase dashboard.

> Storage policies cannot be created via the SQL editor ("must be owner of
> table objects"). Use the Storage → Policies dashboard UI instead.

### Viewer mode

`/c/:id` loads a composition by `publishedId` from Supabase and renders it in
read-only mode. The store sets `viewer: true` which disables autosave, editing,
and the entry screen's library/export/import buttons. CDN URLs in the manifest
are loaded directly by the audio engine — no IndexedDB involved.

### Unpublish

`unpublish(publishedId)` deletes the `compositions` row and removes all
associated stem files from Storage. The local composition's `publishedId` is
cleared.
