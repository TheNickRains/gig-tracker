-- Migration 023: per-artist email signature logo (app-sent outreach goes HTML
-- with a branded signature when this is set).
-- Run in the Supabase SQL editor.
alter table artists add column if not exists sig_logo_url text;

-- Nick's logo (hosted on the app domain):
update artists set sig_logo_url = 'https://gig.nicholasrains.com/sig-logo.png'
where email = 'booking@nickrainsmusic.com';
