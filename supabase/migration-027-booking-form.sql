-- Migration 027: venues that book via web form (no email/phone gate).
-- Run in the Supabase SQL editor.
alter table venues add column if not exists booking_form_url text;
