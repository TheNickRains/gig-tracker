-- Migration 014: notes are editable + deletable (own pipeline's activities).
-- Run in the Supabase SQL editor.
create policy activities_update_own on activities for update to authenticated
  using (exists (select 1 from pipeline_entries pe where pe.id = pipeline_entry_id and pe.artist_id = auth.uid()));
create policy activities_delete_own on activities for delete to authenticated
  using (exists (select 1 from pipeline_entries pe where pe.id = pipeline_entry_id and pe.artist_id = auth.uid()));
