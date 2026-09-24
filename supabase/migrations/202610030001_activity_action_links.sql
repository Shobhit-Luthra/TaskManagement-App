-- Kept separate from the RPC migration: PostgreSQL forbids using a freshly
-- added enum value in the same transaction that adds it.
alter type public.activity_action add value if not exists 'link_added';
alter type public.activity_action add value if not exists 'link_removed';
