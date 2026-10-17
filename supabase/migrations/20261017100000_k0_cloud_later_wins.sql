-- Two machines that changed the same row: the later change is kept, whichever arrives second.
-- Without this, a laptop that comes back online after a day away would send yesterday's version
-- of a story over the one the other machine wrote this morning. Returning NULL from a BEFORE
-- trigger skips the update, so the older change is simply not written.
create or replace function public.k0_records_touch() returns trigger
language plpgsql as $$
begin
  if new.changed_at < old.changed_at then
    return null;
  end if;
  new.seq := nextval('public.records_seq');
  new.updated_at := now();
  return new;
end $$;
