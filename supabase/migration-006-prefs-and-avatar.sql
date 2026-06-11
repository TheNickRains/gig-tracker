-- Migration 006: send preference + profile picture (Supabase Storage).
-- Run in the Supabase SQL editor.

-- Preference: may the assistant send email on the artist's behalf? Default OFF —
-- until they opt in, the app drafts only and the artist sends.
alter table artists add column if not exists allow_auto_send boolean default false;

-- Avatar image URL (file lives in the public 'avatars' storage bucket).
alter table artists add column if not exists avatar_url text;

-- Public 'avatars' bucket.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Anyone can read avatars (public bucket); an artist can write only files inside
-- their own uid-named folder (e.g. "<uid>/avatar").
create policy "avatars public read" on storage.objects
  for select using ( bucket_id = 'avatars' );
create policy "avatars insert own" on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text );
create policy "avatars update own" on storage.objects
  for update to authenticated
  using ( bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text );
