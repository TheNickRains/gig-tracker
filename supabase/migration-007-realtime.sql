    -- Migration 007: enable Supabase Realtime (websockets) on the tables the worker
    -- writes, so the browser updates live the instant a reply lands. RLS still
    -- applies — clients only receive changes to their own rows.
    -- Run in the Supabase SQL editor.
    alter publication supabase_realtime add table activities;
    alter publication supabase_realtime add table pipeline_entries;
