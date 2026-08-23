-- Artist tone matrix: per-context voice calibrations (message intent × room
-- class) learned from everything the artist sends, applied on top of the
-- blanket tone_profile. Shape: {"cells": {"cold|bar": "note", ...},
-- "counts": {"cold|bar": 5}, "at": iso}. Written by the worker only.
alter table artists add column if not exists tone_matrix jsonb;
