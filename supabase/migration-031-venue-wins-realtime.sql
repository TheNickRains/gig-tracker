-- venue_wins was created in migration-021 but never added to the realtime
-- publication. The app subscribes to it (pipeline-rt channel), and a channel
-- with a binding to an unpublished table fails to subscribe entirely.
-- Already applied manually in the SQL editor on 2026-08-19; kept here so the
-- repo matches the database.
alter publication supabase_realtime add table venue_wins;
