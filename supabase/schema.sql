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