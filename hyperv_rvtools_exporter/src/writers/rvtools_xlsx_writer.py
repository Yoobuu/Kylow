from pathlib import Path
from typing import Dict, List, Any

from openpyxl import Workbook


class RVToolsXlsxWriter:
    def __init__(self, contract: Dict[str, Any]):
        self.contract = contract

    def write(self, sheet_rows: Dict[str, List[Dict[str, Any]]], dest_path: Path) -> List[Dict[str, Any]]:
        """
        Create an XLSX matching the RVTools contract.
        Returns a list of summaries per sheet.
        """
        wb = Workbook()
        # Remove default sheet to keep ordering exact
        default = wb.active
        wb.remove(default)

        summaries = []

        sheets_meta = self.contract.get("sheets", {})
        for sheet_name in self.contract.get("sheet_order", []):
            meta = sheets_meta.get(sheet_name, {})
            columns = meta.get("columns", [])

            ws = wb.create_sheet(title=sheet_name)
            ws.append(columns)

            rows = sheet_rows.get(sheet_name, []) or []
            for row in rows:
                ordered = []
                for col in columns:
                    val = row.get(col, "")
                    ordered.append("" if val is None else val)
                ws.append(ordered)

            summaries.append({
                "sheet": sheet_name,
                "columns": len(columns),
                "rows": len(rows)
            })

        dest_path.parent.mkdir(parents=True, exist_ok=True)
        wb.save(dest_path)
        return summaries
