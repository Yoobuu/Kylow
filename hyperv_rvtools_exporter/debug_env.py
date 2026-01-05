import os
from pathlib import Path
from dotenv import dotenv_values

def main():
    env_path = Path("backend/.env")
    if not env_path.exists():
        print(f"ERROR: {env_path} not found")
        return

    config = dotenv_values(env_path)
    
    keys_of_interest = [
        "HYPERV_USER", "VCENTER_USER",
        "HYPERV_PASSWORD", "VCENTER_PASSWORD", 
        "HYPERV_HOSTS"
    ]
    
    print(f"--- Debugging {env_path} ---")
    for k in keys_of_interest:
        val = config.get(k)
        if val:
            if "PASSWORD" in k:
                print(f"{k}: {'*' * len(val)} (Length: {len(val)})")
            else:
                print(f"{k}: {val}")
        else:
            print(f"{k}: [NOT SET]")

if __name__ == "__main__":
    main()
