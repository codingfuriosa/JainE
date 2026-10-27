-- THE AUTOMATIC WELCOME LETTER IS HELD WHEN THE BOOKING AMOUNT IS NOT THE PROJECT'S FIXED ONE
-- (27 Oct 2026, as asked). Dream World City Rs. 1,00,000; Dream Ananta and Dream Gurukul
-- Rs. 2,10,000 - kept in customer-invite/booking-mail.ts (FIXED_BOOKING_AMOUNT). A held letter is
-- not sent; Pallabita Ghosh is emailed why, once, and sends it herself from the editor.

alter table acc.booking_doc_status add column if not exists auto_held_at timestamptz;
alter table acc.booking_doc_status add column if not exists auto_held_reason text;
