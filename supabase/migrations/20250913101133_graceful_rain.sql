/*
  # Create portfolios table for user portfolio management

  1. New Tables
    - `portfolios`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to auth.users)
      - `total_cash` (numeric, total cash allocated)
      - `available_cash` (numeric, cash available for trading)
      - `margin_used` (numeric, margin currently used)
      - `total_portfolio_value` (numeric, total portfolio value)
      - `unrealized_pnl` (numeric, unrealized profit/loss)
      - `realized_pnl` (numeric, realized profit/loss)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Security
    - Enable RLS on `portfolios` table
    - Add policy for users to manage their own portfolio
*/

CREATE TABLE IF NOT EXISTS portfolios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  total_cash numeric DEFAULT 100000.00 NOT NULL,
  available_cash numeric DEFAULT 100000.00 NOT NULL,
  margin_used numeric DEFAULT 0.00 NOT NULL,
  total_portfolio_value numeric DEFAULT 100000.00 NOT NULL,
  unrealized_pnl numeric DEFAULT 0.00 NOT NULL,
  realized_pnl numeric DEFAULT 0.00 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own portfolio"
  ON portfolios
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_portfolios_user_id ON portfolios(user_id);