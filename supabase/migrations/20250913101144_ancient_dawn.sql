/*
  # Create trades table for tracking all trading activity

  1. New Tables
    - `trades`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to auth.users)
      - `symbol` (text, stock symbol)
      - `action` (text, BUY/SELL/SHORT/COVER)
      - `quantity` (integer, number of shares)
      - `price` (numeric, execution price)
      - `total_amount` (numeric, total trade value)
      - `stop_loss` (numeric, optional stop loss price)
      - `timestamp` (timestamp, trade execution time)
      - `status` (text, trade status)

  2. Security
    - Enable RLS on `trades` table
    - Add policy for users to view their own trades
    - Add policy for admins to view all trades
*/

CREATE TABLE IF NOT EXISTS trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  symbol text NOT NULL,
  action text CHECK (action IN ('BUY', 'SELL', 'SHORT', 'COVER')) NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  price numeric NOT NULL CHECK (price > 0),
  total_amount numeric NOT NULL,
  stop_loss numeric,
  timestamp timestamptz DEFAULT now() NOT NULL,
  status text CHECK (status IN ('pending', 'executed', 'cancelled')) DEFAULT 'executed' NOT NULL
);

ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own trades"
  ON trades
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own trades"
  ON trades
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all trades"
  ON trades
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.auth_id = auth.uid() 
      AND users.role = 'admin'
    )
  );

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_trades_user_timestamp ON trades(user_id, timestamp DESC);