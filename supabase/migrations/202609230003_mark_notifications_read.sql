create function public.mark_notification_read(p_notification_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  update public.notifications n set read_at = coalesce(n.read_at, now())
  where n.id = p_notification_id and n.user_id = auth.uid() and public.is_project_member(n.project_id);
  if not found then raise exception 'NOTIFICATION_NOT_FOUND' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function public.mark_notification_read(uuid) from public;
grant execute on function public.mark_notification_read(uuid) to authenticated;

create function public.mark_all_notifications_read() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  update public.notifications n set read_at = now()
  where n.user_id = auth.uid() and n.read_at is null and public.is_project_member(n.project_id);
end;
$$;
revoke all on function public.mark_all_notifications_read() from public;
grant execute on function public.mark_all_notifications_read() to authenticated;
