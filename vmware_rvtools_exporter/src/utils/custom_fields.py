from typing import Dict, Tuple


def load_custom_field_map(content) -> Dict[int, str]:
    mapping: Dict[int, str] = {}
    if not content:
        return mapping
    manager = getattr(content, "customFieldsManager", None)
    fields = getattr(manager, "field", None) if manager else None
    if not fields:
        return mapping
    for field in fields:
        key = getattr(field, "key", None)
        name = getattr(field, "name", None)
        if key is not None and name:
            mapping[int(key)] = str(name)
    return mapping


def extract_backup_fields(custom_values, field_map: Dict[int, str]) -> Tuple[str, str]:
    backup_status = ""
    last_backup = ""
    for entry in custom_values or []:
        key = getattr(entry, "key", None)
        value = getattr(entry, "value", None)
        if key is None:
            continue
        name = field_map.get(int(key), "")
        if not name:
            continue
        name_l = name.lower()
        value_str = str(value) if value is not None else ""
        if not value_str:
            continue
        if not last_backup and ("last backup" in name_l or "lastbackup" in name_l):
            last_backup = value_str
            continue
        if not backup_status:
            if (
                "backup" in name_l
                or "veeam" in name_l
                or "rubrik" in name_l
                or "commvault" in name_l
            ):
                backup_status = value_str
    return backup_status, last_backup
