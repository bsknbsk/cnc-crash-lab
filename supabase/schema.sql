create table repair_costs (
  crash_type      text primary key check (crash_type in
    ('MISSING_G43','WRONG_WORK_OFFSET','RAPID_INTO_STOCK','RAPID_INTO_VISE','FEED_SPINDLE_OFF')),
  damaged_parts   text not null,
  min_inr         integer not null,
  max_inr         integer not null,
  downtime_hours  integer not null
);
alter table repair_costs enable row level security;

insert into repair_costs (crash_type, damaged_parts, min_inr, max_inr, downtime_hours) values
('MISSING_G43',
 'End mill, BT40 holder, spindle bearings (runout check and possible rebuild), Z-axis ballscrew support bearing check, stock scrapped',
 40000, 450000, 48),
('WRONG_WORK_OFFSET',
 'End mill, holder, spindle runout check and possible bearing replacement, stock scrapped',
 25000, 250000, 24),
('RAPID_INTO_STOCK',
 'End mill, possible holder damage, spindle runout check, stock scrapped',
 8000, 150000, 8),
('RAPID_INTO_VISE',
 'End mill, holder, jaw plate set, vise realignment, spindle runout check',
 15000, 200000, 12),
('FEED_SPINDLE_OFF',
 'End mill broken or chipped, stock rework',
 2000, 25000, 2);

alter table repair_costs add column habit text;

update repair_costs set habit = 'After every M06, check that the G43 H number matches the T number. Run the first Z approach in single block at 25% rapid override and watch distance-to-go.' where crash_type = 'MISSING_G43';
update repair_costs set habit = 'Before cycle start, confirm the active work offset matches the setup sheet and compare the offset page values. Run the first Z approach in single block at 25% rapid and watch distance-to-go.' where crash_type = 'WRONG_WORK_OFFSET';
update repair_costs set habit = 'Read the sign of every Z value at dry run. Never rapid below the clearance plane above the stock; feed the last 5 mm.' where crash_type = 'RAPID_INTO_STOCK';
update repair_costs set habit = 'Retract Z to clearance before any XY rapid, and check XY paths against the vise jaw positions on the setup sheet.' where crash_type = 'RAPID_INTO_VISE';
update repair_costs set habit = 'Confirm the spindle is running at the programmed S before the first feed move, and watch the spindle load meter at the first plunge.' where crash_type = 'FEED_SPINDLE_OFF';

select crash_type, habit from repair_costs;

-- Exam faults table. Run in the Supabase SQL editor.
-- The server writes with SUPABASE_SECRET_KEY (bypasses RLS);
-- browser anon access stays blocked by the enabled RLS policy gap.
create table if not exists public.exam_faults (
  id bigint generated always as identity primary key,
  crash_type text not null,
  base_program text not null,
  faulty_program text not null,
  changed_line integer not null,
  hint text not null,
  model text not null,
  created_at timestamptz not null default now()
);

alter table public.exam_faults enable row level security;
