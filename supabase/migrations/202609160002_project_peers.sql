-- Exposes display_name/avatar_url (never email) for fellow project members
-- only, so assignee pickers, avatars, and activity actors resolve names
-- for everyone, not just the signed-in user (T5).
create view public.project_peers as
  select u.id, u.display_name, u.avatar_url
  from public.users u
  where u.deleted_at is null;

alter view public.project_peers set (security_invoker = true);

create policy users_project_peers on public.users for select using (
  exists (
    select 1
    from public.memberships a
    join public.memberships b on a.project_id = b.project_id
    where a.user_id = auth.uid() and b.user_id = users.id
  )
);
