-- Hand-written: seat_limit must be at least 1 (the POC always counts as a seat).
ALTER TABLE "clients"
  ADD CONSTRAINT "clients_seat_limit_positive_chk"
  CHECK ("seat_limit" >= 1);
