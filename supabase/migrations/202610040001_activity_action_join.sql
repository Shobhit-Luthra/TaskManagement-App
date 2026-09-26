-- Kept separate from the RPC migration: PostgreSQL forbids using a freshly
-- added enum value in the same transaction that adds it.
alter type public.activity_action add value if not exists 'join_requested';
alter type public.activity_action add value if not exists 'join_denied';
alter type public.notification_type add value if not exists 'join_requested';
alter type public.notification_category add value if not exists 'membership';
