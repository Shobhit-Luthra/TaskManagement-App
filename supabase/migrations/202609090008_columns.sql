create or replace function public.create_project_column(p_project_id uuid, p_name text, p_wip_limit smallint default null)
returns table (id uuid, project_id uuid, name varchar, "position" double precision, wip_limit smallint, is_done_column boolean, is_in_progress_column boolean)
language plpgsql security definer set search_path = public as $$
declare current_user_id uuid := auth.uid(); column_row public.columns%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not exists (select 1 from public.memberships where project_id = p_project_id and user_id = current_user_id and role in ('owner', 'admin')) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 60 then raise exception 'INVALID_COLUMN_NAME' using errcode = '22023'; end if;
  if p_wip_limit is not null and p_wip_limit <= 0 then raise exception 'INVALID_WIP_LIMIT' using errcode = '22023'; end if;
  insert into public.columns (project_id, name, position, wip_limit) values (p_project_id, trim(p_name), coalesce((select max(c.position) + 1 from public.columns c where c.project_id = p_project_id and c.deleted_at is null), 1), p_wip_limit) returning * into column_row;
  return query select column_row.id, column_row.project_id, column_row.name, column_row.position, column_row.wip_limit, column_row.is_done_column, column_row.is_in_progress_column;
end; $$;

create or replace function public.update_project_column(p_project_id uuid, p_column_id uuid, p_name text, p_wip_limit smallint, p_is_done_column boolean)
returns table (id uuid, project_id uuid, name varchar, "position" double precision, wip_limit smallint, is_done_column boolean, is_in_progress_column boolean)
language plpgsql security definer set search_path = public as $$
declare current_user_id uuid := auth.uid(); column_row public.columns%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not exists (select 1 from public.memberships where project_id = p_project_id and user_id = current_user_id and role in ('owner', 'admin')) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 60 then raise exception 'INVALID_COLUMN_NAME' using errcode = '22023'; end if;
  if p_wip_limit is not null and p_wip_limit <= 0 then raise exception 'INVALID_WIP_LIMIT' using errcode = '22023'; end if;
  select * into column_row from public.columns where id = p_column_id and project_id = p_project_id and deleted_at is null for update;
  if not found then raise exception 'COLUMN_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_is_done_column then update public.columns set is_done_column = false where project_id = p_project_id and id <> p_column_id and is_done_column; end if;
  update public.columns set name = trim(p_name), wip_limit = p_wip_limit, is_done_column = p_is_done_column where id = p_column_id returning * into column_row;
  return query select column_row.id, column_row.project_id, column_row.name, column_row.position, column_row.wip_limit, column_row.is_done_column, column_row.is_in_progress_column;
end; $$;
revoke all on function public.create_project_column(uuid, text, smallint) from public;
revoke all on function public.update_project_column(uuid, uuid, text, smallint, boolean) from public;
grant execute on function public.create_project_column(uuid, text, smallint) to authenticated;
grant execute on function public.update_project_column(uuid, uuid, text, smallint, boolean) to authenticated;
