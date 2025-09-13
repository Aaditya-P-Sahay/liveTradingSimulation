/*
  # Create positions table for tracking user positions

  1. New Tables
    - `positions`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to auth.users)
      - `symbol` (text, stock symbol)
      - `quantity` (integer, number of shares)
      - `average_price` (numeric, average purchase price)
      - `current_price` (numeric, current market price)
      - `position_type` (text, 'long' or 'short')
      - `unrealized_pnl` (numeric, unrealized profit/loss)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Security
    - Enable RLS on `positions` table
    - Add policy for users to manage their own positions
*/

CREATE TABLE IF NOT EXISTS positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  symbol text NOT NULL,
  quantity integer NOT NULL,
  average_price numeric NOT NULL,
  current_price numeric NOT NULL,
  position_type text CHECK (position_type IN ('long', 'short')) DEFAULT 'long' NOT NULL,
  unrealized_pnl numeric DEFAULT 0.00 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own positions"
  ON positions
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_positions_user_id ON positions(user_id);
CREATE INDEX IF NOT EXISTS idx_positions_symbol ON positions(symbol);
CREATE INDEX IF NOT EXISTS idx_positions_user_symbol ON positions(user_id, symbol);