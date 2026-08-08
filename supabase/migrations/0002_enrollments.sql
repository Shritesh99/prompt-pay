-- A payout wallet must enroll (prove control + pass a human check) before it
-- can earn. This is the identity the daily cap is keyed on, so generating extra
-- signing keys gives no benefit — they all settle to the same enrolled wallet.
create table if not exists enrollments (
  wallet      text primary key,
  enrolled_at bigint not null
);
