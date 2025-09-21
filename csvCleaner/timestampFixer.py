import pandas as pd
import os
from datetime import datetime

def process_market_data_csv(input_file, output_file=None):
    """
    Process the market data CSV to fix timestamp and exchange_timestamp issues
    """
    
    if not os.path.exists(input_file):
        print(f"Error: Input file '{input_file}' not found.")
        return None
    
    if output_file is None:
        name, ext = os.path.splitext(input_file)
        output_file = f"{name}_processed{ext}"
    
    print(f"Reading {input_file}...")
    
    try:
        # CRITICAL: Read ALL columns as strings first to prevent any auto-conversion
        df = pd.read_csv(input_file, dtype=str)
        
        print(f"Original data shape: {df.shape}")
        print("Sample original data:")
        print(f"Timestamp: {df['timestamp'].iloc[0]}")
        print(f"Exchange timestamp: {df['exchange_timestamp'].iloc[0]}")
        
        # Make a copy
        processed_df = df.copy()
        
        # 1. Fix the timestamp column using your proven method
        print("Processing timestamp column...")
        if 'timestamp' in processed_df.columns:
            processed_df['timestamp'] = pd.to_datetime(processed_df['timestamp'])
            # Convert to string format for CSV saving
            processed_df['timestamp'] = processed_df['timestamp'].dt.strftime('%Y-%m-%d %H:%M:%S.%f')
            print("✓ Timestamp column processed and formatted for CSV")
        
        # 2. Fix exchange_timestamp - keep as string to preserve full precision
        print("Processing exchange_timestamp column...")
        if 'exchange_timestamp' in processed_df.columns:
            # Keep as string or convert to int only if it doesn't have scientific notation
            def clean_exchange_timestamp(val):
                val_str = str(val).strip()
                if 'E+' in val_str or 'e+' in val_str:
                    # Convert from scientific notation to full number
                    return str(int(float(val_str)))
                return val_str
            
            processed_df['exchange_timestamp'] = processed_df['exchange_timestamp'].apply(clean_exchange_timestamp)
            print("✓ Exchange timestamp preserved with full precision")
        
        # Convert numeric columns back to proper types (except timestamp and exchange_timestamp)
        numeric_columns = [
            'token', 'last_traded_price', 'volume_traded', 'open_price', 'high_price', 
            'low_price', 'close_price', 'total_buy_quantity', 'total_sell_quantity', 
            'average_traded_price'
        ]
        
        for col in numeric_columns:
            if col in processed_df.columns:
                processed_df[col] = pd.to_numeric(processed_df[col], errors='coerce')
        
        # Save with specific options to prevent format changes
        print(f"Saving processed data to {output_file}...")
        processed_df.to_csv(output_file, index=False, quoting=1)  # Quote all fields
        
        print(f"✓ Successfully processed {len(processed_df)} records")
        print(f"✓ Output saved to: {output_file}")
        
        # Display sample of processed data
        print("\nSample of processed data:")
        print(f"Timestamp: {processed_df['timestamp'].iloc[0]}")
        print(f"Exchange timestamp: {processed_df['exchange_timestamp'].iloc[0]}")
        print(processed_df[['timestamp', 'symbol', 'company_name', 'last_traded_price', 'exchange_timestamp']].head(3))
        
        return processed_df
        
    except Exception as e:
        print(f"Error processing file: {e}")
        import traceback
        traceback.print_exc()
        return None

if __name__ == "__main__":
    print("Market Data CSV Processor - FIXED VERSION")
    print("=" * 50)
    
    # Process your main CSV file
    input_file = 'live_market_data_20250919_095441.csv'
    
    if os.path.exists(input_file):
        processed_df = process_market_data_csv(input_file)
        
        if processed_df is not None:
            print("\n" + "="*50)
            print("SUCCESS! Check your processed CSV file now.")
            print("Timestamps should be readable and exchange_timestamps should have full precision!")
    else:
        print(f"File '{input_file}' not found. Update the filename in the script.")