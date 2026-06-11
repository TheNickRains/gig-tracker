-- Migration 004: store the Google refresh token via a SECURITY DEFINER function.
-- The client calls this RPC; the function writes the row as the table owner
-- (bypassing RLS) but pins artist_id to auth.uid(), so a user can only ever
-- write their own connection. This avoids client-side INSERT-vs-RLS issues and
-- keeps the token write-only from the browser's perspective.
-- Run in the Supabase SQL editor.

create or replace function store_google_token(p_refresh_token text, p_scope text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into google_connections (artist_id, refresh_token, scope, updated_at)
  values (auth.uid(), p_refresh_token, p_scope, now())
  on conflict (artist_id) do update
    set refresh_token = excluded.refresh_token,
        scope = excluded.scope,
        updated_at = now();

  update artists set gmail_connected = true where id = auth.uid();
end;
$$;

grant execute on function store_google_token(text, text) to authenticated;
