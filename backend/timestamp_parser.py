import sys
import json
import pandas as pd
from datetime import datetime
import traceback

def parse_timestamp(timestamp_str):
    """
    Parse timestamp exactly like your working Python code
    Returns Unix timestamp in seconds
    """
    try:
        # Use pandas to_datetime exactly like your working code
        dt = pd.to_datetime(timestamp_str)
        # Convert to Unix timestamp in seconds
        return int(dt.timestamp())
    except Exception as e:
        print(f"Error parsing timestamp '{timestamp_str}': {e}", file=sys.stderr)
        # Return current time as fallback
        return int(datetime.now().timestamp())

def parse_timestamps_batch(timestamps):
    """
    Parse multiple timestamps in batch for efficiency
    """
    results = []
    for ts in timestamps:
        results.append(parse_timestamp(ts))
    return results

def main():
    try:
        # Read input from stdin
        input_data = sys.stdin.read()
        data = json.loads(input_data)
        
        if isinstance(data, list):
            # Batch processing
            results = parse_timestamps_batch(data)
        else:
            # Single timestamp
            results = parse_timestamp(data)
        
        # Output result as JSON
        print(json.dumps(results))
        
    except Exception as e:
        print(f"Python timestamp parser error: {e}", file=sys.stderr)
        print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
        # Return fallback
        if isinstance(data, list):
            print(json.dumps([int(datetime.now().timestamp())] * len(data)))
        else:
            print(json.dumps(int(datetime.now().timestamp())))

if __name__ == "__main__":
    main()