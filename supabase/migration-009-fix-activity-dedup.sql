-- Migration 009: the email_message_id unique index was PARTIAL
-- (`where email_message_id is not null`), which PostgREST CANNOT use as an
-- on_conflict target — so the worker's dedup insert failed every time and
-- email replies never logged. Recreate it as a plain (non-partial) unique
-- index. NULLs are still distinct, so manual activities (no message id) are fine.
-- Run in the Supabase SQL editor.
drop index if exists activities_email_msg_uidx;
create unique index if not exists activities_email_msg_uidx on activities (email_message_id);
