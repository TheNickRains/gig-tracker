-- Minimal platform plumbing; application tables come from the real migrations.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls;end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth,public to anon,authenticated,service_role;
grant execute on function auth.uid() to public;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid,name text,bucket_id text);
create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name,'/') $$;
alter default privileges in schema public grant all on tables to authenticated,service_role;
alter default privileges in schema public grant usage on sequences to authenticated,service_role;
create publication supabase_realtime;
