-- 1) System notifications: app updates and notices, for everyone (company_id
--    null) or one company; each user's "read" marks.
create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  kind text not null default 'update' check (kind in ('update', 'info', 'warning')),
  title text not null,
  body text,
  link text,
  created_at timestamptz not null default now()
);
create index if not exists app_notifications_created_idx on public.app_notifications (created_at desc);
alter table public.app_notifications enable row level security;
create policy app_notifications_select on public.app_notifications
  for select to authenticated
  using (company_id is null or company_id = public.auth_company_id());

create table if not exists public.app_notification_reads (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  notification_id uuid not null references public.app_notifications (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, notification_id)
);
alter table public.app_notification_reads enable row level security;
create policy app_notification_reads_select on public.app_notification_reads
  for select to authenticated using (user_id = auth.uid());
create policy app_notification_reads_insert on public.app_notification_reads
  for insert to authenticated with check (user_id = auth.uid());

-- 2) A profile row may not raise its own rights: role, modules, permissions,
--    company and deactivation change only by an owner/admin of the company
--    (through the app), never by the person themselves over the API.
--    Functions running as their owner (invites, restore) are not affected.
create or replace function public.guard_profile_update()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  r text := coalesce(public.auth_role()::text, '');
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if new.id is distinct from old.id or new.company_id is distinct from old.company_id then
    raise exception 'not allowed';
  end if;
  if new.role is distinct from old.role
     or new.modules is distinct from old.modules
     or new.can_open is distinct from old.can_open
     or new.can_see_book is distinct from old.can_see_book
     or new.disabled_at is distinct from old.disabled_at then
    if r not in ('owner', 'admin') then
      raise exception 'not allowed';
    end if;
    if new.role is distinct from old.role then
      if old.id = auth.uid() then raise exception 'own role'; end if;
      if old.role = 'owner' or new.role = 'owner' then raise exception 'owner role'; end if;
      if r = 'admin' and (old.role = 'admin' or new.role = 'admin') then
        raise exception 'admin role';
      end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists user_profiles_guard on public.user_profiles;
create trigger user_profiles_guard before update on public.user_profiles
  for each row execute function public.guard_profile_update();

-- 3) Assigning a role (owner: admin / member / viewer; admin: member / viewer).
create or replace function public.set_member_role(p_user uuid, p_role public.user_role)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me text := coalesce(public.auth_role()::text, '');
  target public.user_profiles;
begin
  select * into target from public.user_profiles
   where id = p_user and company_id = public.auth_company_id();
  if target.id is null then raise exception 'not found'; end if;
  if target.id = auth.uid() then raise exception 'own role'; end if;
  if me not in ('owner', 'admin') then raise exception 'not allowed'; end if;
  if target.role = 'owner' or p_role = 'owner' then raise exception 'owner role'; end if;
  if me = 'admin' and (target.role = 'admin' or p_role = 'admin') then
    raise exception 'admin role';
  end if;
  update public.user_profiles set role = p_role where id = target.id;
end;
$$;
revoke all on function public.set_member_role(uuid, public.user_role) from public, anon;
grant execute on function public.set_member_role(uuid, public.user_role) to authenticated;

-- 4) The updates so far.
insert into public.app_notifications (kind, title, body, link, created_at) values
 ('update', 'ერთ პროდუქტს რამდენიმე ბარკოდი', 'უცნობი კოდის სკანირებისას „🔗 ეს სიაში არსებული პროდუქტია?“ — იმავე მწარმოებლის პროდუქტები ნაშთიდან. არჩეული კოდი პროდუქტს მიებმება.', null, '2026-11-11 13:40:00+00'),
 ('update', 'თაროს გარეშე ნაშთი მთელ ობიექტს ედარება', 'პროდუქტი რომელიმე დახურულ თაროზე თუ დაითვალე, მისი მთელი ნაშთი მაშინვე ედარება — დანაკლისი ჩანს და თარო ხელახლა დათვლას ითხოვს.', '/manage/stocktakes', '2026-11-11 14:05:00+00'),
 ('update', 'ფოტოებით შემოწმება (AI)', 'თაროს შედეგის გვერდზე „🤖 ფოტოებით შემოწმება“ — ფოტოები და ვიდეოს კადრები დათვლილს ედარება. საჭიროა API გასაღები.', null, '2026-11-11 14:20:00+00'),
 ('update', 'სახელით ძებნა სიტყვებით', 'ძებნა ახლა სიტყვებს ცალ-ცალკე ეძებს, ნებისმიერი თანმიმდევრობით და ბრუნვის დაბოლოებების გარეშე.', null, '2026-11-11 14:55:00+00'),
 ('update', 'ახალი დეშბორდი', 'ღია, კლასიკური დიზაინი: გვერდითი მენიუ, ბარათები, აქტივობის გრაფიკი, პროგრესი.', '/manage', '2026-11-11 16:30:00+00'),
 ('update', 'ცხრილები სორტით და ფილტრით', 'ინვენტარიზაციები, სტრიქონები და ობიექტები — ზებრა ზოლები, სორტი და ფილტრი ყოველ სვეტში, ძებნა, CSV.', '/manage/stocktakes', '2026-11-11 18:15:00+00'),
 ('update', '„+“ და დამატება დრავერში', 'ცხრილის ზემოთ მარჯვნივ „+“ — ახალი ინვენტარიზაცია, ობიექტი ან მოწვევა გვერდიდან გამოსულ პანელში.', null, '2026-11-11 18:28:00+00'),
 ('update', 'ადმინისტრაცია, პროფილი, თემა და შეტყობინებები', 'გუნდი და როლები — მენიუს ქვემოთ „ადმინისტრაციაში“. პროფილის მენიუში: ჩემი პროფილი, ღია/მუქი თემა, გასვლა. 🔔 — სისტემური შეტყობინებები.', '/manage/notifications', now());
