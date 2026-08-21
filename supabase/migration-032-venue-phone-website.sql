-- Venue phone + website get real columns. The wizard's Maps autofill used to
-- append them to notes as a "Phone: … · Site: …" line because there was
-- nowhere else to put them; backfill from that line, then strip it.
alter table venues add column if not exists phone text;
alter table venues add column if not exists website text;

update venues set phone = nullif(trim(substring(notes from 'Phone: ([^·\n]+)')), '')
  where phone is null and notes like '%Phone: %';

update venues set website = nullif(trim(substring(notes from 'Site: ([^\n]+)')), '')
  where website is null and notes like '%Site: %';

update venues set notes = nullif(trim(both E' \n' from
    regexp_replace(notes, '(^|\n)(Phone: [^\n]*|Site: [^\n]*)', '', 'g')), '')
  where notes like '%Phone: %' or notes like '%Site: %';
