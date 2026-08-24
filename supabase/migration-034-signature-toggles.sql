-- Signature controls: master on/off + per-field toggles for the HTML
-- signature gmailSend appends (logo itself is sig_logo_url, migration 023).
alter table artists
  add column if not exists sig_enabled boolean not null default true,
  add column if not exists sig_show_website boolean not null default true,
  add column if not exists sig_show_phone boolean not null default true;
