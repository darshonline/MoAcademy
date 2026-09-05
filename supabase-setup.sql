-- ============================================================
-- دفتري الدراسي — إعداد قاعدة البيانات على Supabase
-- انسخ الكود ده كامل وشغّله مرة واحدة من: Supabase Dashboard → SQL Editor → New query
-- ============================================================

create extension if not exists pgcrypto;

-- جدول واحد بيخزن كل بيانات المنصة (السنوات/المواد/الدروس) كـ JSON
create table if not exists app_data (
  id text primary key,
  data jsonb not null default '{"years":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into app_data (id, data)
values ('main', '{"years":[]}'::jsonb)
on conflict (id) do nothing;

-- جدول نتائج الاختبارات
create table if not exists quiz_results (
  id uuid primary key default gen_random_uuid(),
  subject_id text,
  subject_name text,
  lesson_id text,
  lesson_title text,
  score int not null,
  total int not null,
  created_at timestamptz not null default now()
);

-- تفعيل الحماية على مستوى الصفوف (RLS)
alter table app_data enable row level security;
alter table quiz_results enable row level security;

-- app_data: أي حد يقدر يقرأ (عشان الموقع يفتح للطلاب)، لكن الكتابة/التعديل
-- محصورة على المستخدم اللي عمل تسجيل دخول (الأدمن فقط)
create policy "public read app_data" on app_data
  for select using (true);

create policy "auth insert app_data" on app_data
  for insert with check (auth.role() = 'authenticated');

create policy "auth update app_data" on app_data
  for update using (auth.role() = 'authenticated');

-- quiz_results: قراءة وكتابة مفتوحة (استخدام شخصي، النتائج مش بيانات حساسة)
create policy "public read results" on quiz_results
  for select using (true);

create policy "public insert results" on quiz_results
  for insert with check (true);

create policy "public delete results" on quiz_results
  for delete using (true);
