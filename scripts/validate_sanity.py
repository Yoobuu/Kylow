import pandas as pd
import argparse
import json
import sys
import re
from pathlib import Path
from typing import Dict, List, Any, Set, Optional

# --- Configuration & Constants ---

# Thresholds for sanity warnings
THRESHOLDS = {
    "RAM_MIN_MIB": 64,          # Suspicious if VM has < 64MB
    "RAM_MAX_MIB": 1024 * 1024 * 4, # Suspicious if VM has > 4TB
    "VCPU_MAX": 256,            # Suspicious if > 256 vCPUs
    "MTU_MIN": 576,
    "MTU_MAX": 9000,
    "YEAR_MIN": 2000,
    "YEAR_MAX": 2035,
}

# Regex Patterns
REGEX = {
    "MAC": r"^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$",
    "IPV4": r"^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$",
    "WWN": r"^([0-9a-fA-F]{2}:){7}[0-9a-fA-F]{2}$|^[0-9a-fA-F]{16}$", # Colon separated or just hex
    "UUID": r"[0-9a-fA-F-]{32,}", # Basic UUID check
}

# Expected Columns (Critical ones for validation)
SHEET_COLS = {
    "vInfo": ["VM", "Powerstate", "Template", "DNS Name", "CPUs", "Memory", "Primary IP Address"],
    "vCPU": ["VM", "CPUs"],
    "vMemory": ["VM", "Size MiB", "Consumed"],
    "vDisk": ["VM", "Capacity MiB", "Free MiB"],
    "vNetwork": ["VM", "Network", "Mac Address", "IPv4 Address"],
    "vHost": ["Host", "# CPU", "# Memory", "# VMs"],
    "vDatastore": ["Name", "Capacity MiB", "Free MiB", "Type"],
    "vPartition": ["VM", "Capacity MiB", "Free MiB"],
    "vLicense": ["Name", "Total", "Used"],
    "vRP": ["Resource Pool name", "CPU limit", "Mem limit"],
    "vHealth": ["Name", "Message", "Message type"],
}

class SanityValidator:
    def __init__(self, excel_path: str):
        self.excel_path = excel_path
        self.report = {
            "summary": {"total_sheets": 0, "total_errors": 0, "total_warnings": 0},
            "sheets": {},
            "cross_sheet": {}
        }
        self.sheets: Dict[str, pd.DataFrame] = {}
        
        # Reference Sets for Cross-Validation
        self.ref_vms: Set[str] = set()
        self.ref_hosts: Set[str] = set()
        self.ref_datastores: Set[str] = set()

    def load(self):
        print(f"Loading {self.excel_path} ...")
        try:
            # Read all sheets
            self.sheets = pd.read_excel(self.excel_path, sheet_name=None)
            self.report["summary"]["total_sheets"] = len(self.sheets)
        except Exception as e:
            print(f"FATAL: Could not read Excel file: {e}")
            sys.exit(1)

    def _log_sheet_result(self, sheet_name: str, result: Dict):
        self.report["sheets"][sheet_name] = result
        self.report["summary"]["total_errors"] += len(result.get("errors", []))
        self.report["summary"]["total_warnings"] += len(result.get("warnings", []))

    def _check_numeric(self, df: pd.DataFrame, col: str, min_val=None, max_val=None, must_be_int=False) -> List[str]:
        warnings = []
        if col not in df.columns:
            return [] # Missing column handled elsewhere
        
        # Drop empty
        series = df[col].dropna()
        # Convert to numeric, errors='coerce' turns non-parseable to NaN
        numeric = pd.to_numeric(series, errors='coerce')
        
        # Check non-parseable
        invalid_count = numeric.isna().sum()
        if invalid_count > 0:
            warnings.append(f"Column '{col}' has {invalid_count} non-numeric values")
        
        # Range checks
        valid = numeric.dropna()
        if min_val is not None:
            outliers = valid[valid < min_val]
            if not outliers.empty:
                warnings.append(f"Column '{col}' has {len(outliers)} values < {min_val} (min={outliers.min()})")
        
        if max_val is not None:
            outliers = valid[valid > max_val]
            if not outliers.empty:
                warnings.append(f"Column '{col}' has {len(outliers)} values > {max_val} (max={outliers.max()})")
                
        return warnings

    def _check_missing(self, df: pd.DataFrame, cols: List[str], threshold_pct=0.95) -> List[str]:
        warnings = []
        rows = len(df)
        if rows == 0:
            return []
            
        for col in cols:
            if col not in df.columns:
                warnings.append(f"MISSING COLUMN: '{col}'")
                continue
            
            # Count empty string or NaN
            empty_count = df[col].replace(r'^\s*$', pd.NA, regex=True).isna().sum()
            pct = empty_count / rows
            if pct > threshold_pct:
                warnings.append(f"Column '{col}' is {pct:.1%} empty ({empty_count}/{rows})")
        return warnings

    def validate_vinfo(self):
        sheet = "vInfo"
        if sheet not in self.sheets: return
        df = self.sheets[sheet]
        res = {"rows": len(df), "warnings": [], "errors": []}
        
        # Populate Reference VM Set
        if "VM" in df.columns:
            self.ref_vms = set(df["VM"].dropna().unique())
            
            # Duplicates
            dupes = df["VM"].duplicated().sum()
            if dupes > 0:
                res["warnings"].append(f"Found {dupes} duplicate VM names")
        
        res["warnings"].extend(self._check_missing(df, ["VM", "Powerstate", "Host", "Cluster"]))
        
        # PowerState consistency logic could go here
        
        self._log_sheet_result(sheet, res)

    def validate_vcpu(self):
        sheet = "vCPU"
        if sheet not in self.sheets: return
        df = self.sheets[sheet]
        res = {"rows": len(df), "warnings": [], "errors": []}
        
        res["warnings"].extend(self._check_numeric(df, "CPUs", min_val=1, max_val=THRESHOLDS["VCPU_MAX"]))
        
        # Check orphans
        if "VM" in df.columns and self.ref_vms:
            orphans = df[~df["VM"].isin(self.ref_vms)]["VM"].unique()
            if len(orphans) > 0:
                res["warnings"].append(f"{len(orphans)} VMs in vCPU not found in vInfo (e.g. {orphans[:3]})")

        self._log_sheet_result(sheet, res)

    def validate_vmemory(self):
        sheet = "vMemory"
        if sheet not in self.sheets: return
        df = self.sheets[sheet]
        res = {"rows": len(df), "warnings": [], "errors": []}
        
        # RVTools uses "Size MiB"
        res["warnings"].extend(self._check_numeric(df, "Size MiB", min_val=0))
        
        # Logic check: Consumed vs Size
        if "Size MiB" in df.columns and "Consumed" in df.columns:
            # Consumed is usually in MiB in RVTools? Header just says "Consumed" sometimes or "Consumed MiB"
            # Based on compat layer, we mapped "Consumed" -> "Consumed_MB". 
            # Wait, compat layer MAPPINGS for vMemory: "Consumed": "Consumed_MB". 
            # Headers in RVTOOLEX.xlsx for vMemory: "Consumed". 
            # Assuming values are MiB.
            
            # Convert to numeric first
            s_size = pd.to_numeric(df["Size MiB"], errors='coerce').fillna(0)
            s_cons = pd.to_numeric(df["Consumed"], errors='coerce').fillna(0)
            
            # Warn if Consumed > Size * 1.5 (Memory overhead + ballooning can exceed size but usually not by 50% without suspicion)
            over = s_cons > (s_size * 1.5)
            if over.any():
                res["warnings"].append(f"{over.sum()} VMs have Consumed > Size * 1.5")

        self._log_sheet_result(sheet, res)

    def validate_vdisk(self):
        sheet = "vDisk"
        if sheet not in self.sheets: return
        df = self.sheets[sheet]
        res = {"rows": len(df), "warnings": [], "errors": []}
        
        res["warnings"].extend(self._check_numeric(df, "Capacity MiB", min_val=0))
        res["warnings"].extend(self._check_missing(df, ["VM", "Disk", "Capacity MiB"]))
        
        self._log_sheet_result(sheet, res)

    def validate_vhost(self):
        sheet = "vHost"
        if sheet not in self.sheets: return
        df = self.sheets[sheet]
        res = {"rows": len(df), "warnings": [], "errors": []}
        
        if "Host" in df.columns:
            self.ref_hosts = set(df["Host"].dropna().unique())
            
        res["warnings"].extend(self._check_numeric(df, "# CPU", min_val=1))
        # # Memory can be 0 if parsing failed or disconnected?
        
        self._log_sheet_result(sheet, res)

    def validate_vdatastore(self):
        sheet = "vDatastore"
        if sheet not in self.sheets: return
        df = self.sheets[sheet]
        res = {"rows": len(df), "warnings": [], "errors": []}
        
        if "Name" in df.columns:
            self.ref_datastores = set(df["Name"].dropna().unique())
            
        res["warnings"].extend(self._check_numeric(df, "Capacity MiB", min_val=0))
        
        # Check Free <= Capacity
        if "Capacity MiB" in df.columns and "Free MiB" in df.columns:
            s_cap = pd.to_numeric(df["Capacity MiB"], errors='coerce').fillna(0)
            s_free = pd.to_numeric(df["Free MiB"], errors='coerce').fillna(0)
            invalid = s_free > s_cap
            if invalid.any():
                res["errors"].append(f"{invalid.sum()} Datastores have Free > Capacity")

        self._log_sheet_result(sheet, res)

    def validate_generic_networking(self, sheet_name):
        if sheet_name not in self.sheets: return
        df = self.sheets[sheet_name]
        res = {"rows": len(df), "warnings": [], "errors": []}
        
        # MTU checks
        if "MTU" in df.columns:
            res["warnings"].extend(self._check_numeric(df, "MTU", min_val=THRESHOLDS["MTU_MIN"], max_val=THRESHOLDS["MTU_MAX"]))
            
        # MAC Checks
        if "Mac Address" in df.columns: # vNetwork uses "Mac Address"
            macs = df["Mac Address"].dropna().astype(str)
            # Filter standard "00:50:..." format or dashed
            valid_mac = macs.str.match(REGEX["MAC"])
            if (~valid_mac).any():
                # Don't error, just warn, maybe regex is too strict or format varies
                res["warnings"].append(f"{(~valid_mac).sum()} values in 'Mac Address' look malformed")
        elif "MAC" in df.columns: # vNIC uses "MAC"
             macs = df["MAC"].dropna().astype(str)
             valid_mac = macs.str.match(REGEX["MAC"])
             if (~valid_mac).any():
                 res["warnings"].append(f"{(~valid_mac).sum()} values in 'MAC' look malformed")

        self._log_sheet_result(sheet_name, res)

    def validate_vpartition(self):
        sheet = "vPartition"
        if sheet not in self.sheets: return
        df = self.sheets[sheet]
        res = {"rows": len(df), "warnings": [], "errors": []}
        
        res["warnings"].extend(self._check_numeric(df, "Capacity MiB", min_val=0))
        res["warnings"].extend(self._check_numeric(df, "Free MiB", min_val=0))
        
        self._log_sheet_result(sheet, res)

    def run(self):
        self.load()
        
        # Order matters for ref sets
        self.validate_vinfo()
        self.validate_vhost()
        self.validate_vdatastore()
        
        # Other sheets
        self.validate_vcpu()
        self.validate_vmemory()
        self.validate_vdisk()
        self.validate_vpartition()
        
        self.validate_generic_networking("vNetwork")
        self.validate_generic_networking("vNIC")
        self.validate_generic_networking("vSwitch")
        self.validate_generic_networking("dvSwitch")
        
        # Generic checks for the rest (simple non-empty check on key columns)
        for sheet, cols in SHEET_COLS.items():
            if sheet in self.report["sheets"]: continue # Already done
            if sheet not in self.sheets: continue
            
            df = self.sheets[sheet]
            res = {"rows": len(df), "warnings": [], "errors": []}
            res["warnings"].extend(self._check_missing(df, cols))
            self._log_sheet_result(sheet, res)

        self._save()

    def _save(self):
        # Console Output
        print("\n" + "="*80)
        print(f"{ 'Sheet':<15} | { 'Rows':<6} | { 'Status':<10} | { 'Warnings':<40}")
        print("-" * 80)
        
        for sheet, stats in self.report["sheets"].items():
            status = "OK"
            if stats["errors"]:
                status = "ERR"
            elif stats["warnings"]:
                status = "WARN"
            
            warn_msg = ""
            if stats["warnings"]:
                warn_msg = stats["warnings"][0] 
                if len(stats["warnings"]) > 1:
                    warn_msg += f" (+{len(stats['warnings'])-1} more)"
            elif stats["errors"]:
                warn_msg = stats["errors"][0]
            
            print(f"{sheet:<15} | {stats['rows']:<6} | {status:<10} | {warn_msg}")
            
        print("="*80 + "\n")
        
        # JSON Output
        out_file = Path("out/sanity_report.json")
        out_file.parent.mkdir(parents=True, exist_ok=True)
        with out_file.open("w", encoding="utf-8") as f:
            json.dump(self.report, f, indent=2, default=str)
        print(f"Detailed JSON report saved to: {out_file}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("xlsx_path", nargs="?", default="vmware_rvtools_exporter/out/export.xlsx")
    args = parser.parse_args()
    
    checker = SanityValidator(args.xlsx_path)
    checker.run()
