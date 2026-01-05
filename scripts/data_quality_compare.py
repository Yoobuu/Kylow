import argparse
import json
import pandas as pd
import sys
from pathlib import Path
from typing import Dict, List, Any, Optional

# Helper to identify the "ID" column for a sheet to provide meaningful examples
ID_COLS = {
    "vInfo": "VM",
    "vCPU": "VM",
    "vMemory": "VM",
    "vDisk": "VM",
    "vNetwork": "VM",
    "vTools": "VM",
    "vPartition": "VM",
    "vCD": "VM",
    "vUSB": "VM",
    "vHost": "Host",
    "vHBA": "Host",
    "vNIC": "Host",
    "vSwitch": "Host",
    "vPort": "Host",
    "vSC_VMK": "Host",
    "vHealth": "Name", # or Entity
    "vDatastore": "Name", # Mapped to Datastore usually
    "vCluster": "Name", # Mapped to Cluster
    "vLicense": "Name",
    "vRP": "Resource Pool name",
    "dvSwitch": "Switch",
    "dvPort": "Port",
}

def get_id_col(sheet: str, columns: List[str]) -> Optional[str]:
    # Try explicit map
    if sheet in ID_COLS and ID_COLS[sheet] in columns:
        return ID_COLS[sheet]
    # Fallback heuristics
    for candidate in ["VM", "Host", "Name", "Key", "Entity"]:
        if candidate in columns:
            return candidate
    return columns[0] if len(columns) > 0 else None

def calculate_fill_rate(df: pd.DataFrame, col: str) -> float:
    if len(df) == 0:
        return 0.0
    # Treat empty strings as null
    series = df[col].replace(r'^\s*$', pd.NA, regex=True)
    return 1.0 - (series.isna().sum() / len(df))

def get_empty_examples(df: pd.DataFrame, col: str, id_col: str, limit: int = 5) -> List[str]:
    if len(df) == 0:
        return []
    
    # Filter empty rows
    # We treat NaN and empty strings as empty
    mask = df[col].replace(r'^\s*$', pd.NA, regex=True).isna()
    empty_rows = df[mask]
    
    examples = []
    for _, row in empty_rows.head(limit).iterrows():
        val_id = str(row[id_col]) if id_col and id_col in row else f"Row_{_}"
        examples.append(val_id)
    return examples

def get_filled_examples(df: pd.DataFrame, col: str, limit: int = 5) -> List[str]:
    """Get examples of values from Reference to show what it should look like."""
    if len(df) == 0:
        return []
    series = df[col].replace(r'^\s*$', pd.NA, regex=True).dropna()
    return series.head(limit).astype(str).tolist()

def main():
    parser = argparse.ArgumentParser(description="Compare data quality between two RVTools Excel files.")
    parser.add_argument("reference_xlsx", help="Path to reference RVTools file")
    parser.add_argument("generated_xlsx", help="Path to generated export file")
    parser.add_argument("--out-json", default="vmware_rvtools_exporter/out/quality/quality_report.json", help="Output JSON report path")
    args = parser.parse_args()

    ref_path = Path(args.reference_xlsx)
    gen_path = Path(args.generated_xlsx)

    if not ref_path.exists():
        print(f"Error: Reference file not found: {ref_path}")
        sys.exit(1)
    if not gen_path.exists():
        print(f"Error: Generated file not found: {gen_path}")
        sys.exit(1)

    print(f"Loading Reference: {ref_path}")
    try:
        ref_sheets = pd.read_excel(ref_path, sheet_name=None)
    except Exception as e:
        print(f"Error reading reference: {e}")
        sys.exit(1)

    print(f"Loading Generated: {gen_path}")
    try:
        gen_sheets = pd.read_excel(gen_path, sheet_name=None)
    except Exception as e:
        print(f"Error reading generated: {e}")
        sys.exit(1)

    # Analysis
    report = {
        "sheets": {},
        "top_deltas": []
    }
    
    all_deltas = []

    for sheet_name, ref_df in ref_sheets.items():
        if sheet_name not in gen_sheets:
            print(f"Warning: Sheet {sheet_name} missing in generated file.")
            continue
        
        gen_df = gen_sheets[sheet_name]
        
        # Ensure column alignment (headers should match per previous tests)
        # We focus on columns present in Reference (the target standard)
        
        sheet_stats = {
            "rows_ref": len(ref_df),
            "rows_gen": len(gen_df),
            "columns": {}
        }
        
        id_col_gen = get_id_col(sheet_name, gen_df.columns)
        
        for col in ref_df.columns:
            if col not in gen_df.columns:
                # Missing column entirely (should be caught by compare_rvtools.py, but track here)
                filled_ref = calculate_fill_rate(ref_df, col)
                sheet_stats["columns"][col] = {
                    "filled_ref": filled_ref,
                    "filled_gen": 0.0,
                    "delta": filled_ref
                }
                all_deltas.append({
                    "sheet": sheet_name,
                    "column": col,
                    "ref_filled": filled_ref,
                    "gen_filled": 0.0,
                    "delta": filled_ref,
                    "ref_examples": get_filled_examples(ref_df, col),
                    "gen_empty_examples": [] # Column missing
                })
                continue
            
            filled_ref = calculate_fill_rate(ref_df, col)
            filled_gen = calculate_fill_rate(gen_df, col)
            delta = filled_ref - filled_gen
            
            sheet_stats["columns"][col] = {
                "filled_ref": round(filled_ref, 4),
                "filled_gen": round(filled_gen, 4),
                "delta": round(delta, 4)
            }
            
            # Only care if Reference has data (filled_ref > 0)
            if filled_ref > 0:
                all_deltas.append({
                    "sheet": sheet_name,
                    "column": col,
                    "ref_filled": round(filled_ref, 4),
                    "gen_filled": round(filled_gen, 4),
                    "delta": round(delta, 4),
                    "ref_examples": get_filled_examples(ref_df, col),
                    "gen_empty_examples": get_empty_examples(gen_df, col, id_col_gen) if filled_gen < 1.0 else []
                })

        report["sheets"][sheet_name] = sheet_stats

    # Sort deltas descending
    all_deltas.sort(key=lambda x: x["delta"], reverse=True)
    
    # Top 50
    report["top_deltas"] = all_deltas[:50]
    
    # Save JSON
    out_json = Path(args.out_json)
    out_json.parent.mkdir(parents=True, exist_ok=True)
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
        
    print(f"Report saved to {out_json}")
    
    # Print Console Summary
    print("\n" + "="*100)
    print(f"{ 'Sheet':<12} | { 'Column':<30} | { 'Ref%':<6} | { 'Gen%':<6} | { 'Delta':<6} | {'Examples (Ref Value / Gen Missing ID)'}")
    print("-" * 100)
    
    for item in report["top_deltas"]:
        # Only show significant deltas (e.g. > 10%)
        if item["delta"] < 0.1:
            continue
            
        ref_p = f"{item['ref_filled']*100:.0f}%"
        gen_p = f"{item['gen_filled']*100:.0f}%"
        delta_p = f"{item['delta']*100:.0f}%"
        
        # Example formatting
        ex_ref = str(item['ref_examples'][0]) if item['ref_examples'] else "?"
        ex_gen = str(item['gen_empty_examples'][0]) if item['gen_empty_examples'] else "-"
        examples = f"Ref: '{ex_ref}' ... Gen Missing: {ex_gen} ..."
        
        print(f"{item['sheet']:<12} | {item['column']:<30} | {ref_p:<6} | {gen_p:<6} | {delta_p:<6} | {examples}")
    print("="*100 + "\n")

if __name__ == "__main__":
    main()
