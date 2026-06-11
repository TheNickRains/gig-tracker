-- Migration 005: let an artist disconnect (delete) their own Google connection.
-- Run in the Supabase SQL editor.
create policy gc_delete_own on google_connections for delete to authenticated
  using (artist_id = auth.uid());
