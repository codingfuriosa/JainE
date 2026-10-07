-- Warehouse type (Main store, Site store, ...). Free text so the list of types can grow without a schema change; optional.
alter table purchase.warehouses add column if not exists wh_type text;
comment on column purchase.warehouses.wh_type is 'Kind of store, e.g. Main store / Site store / Godown. Free text, optional.';
