from typing import Any, Dict, List, Optional, Tuple, Callable

# --- Helper Conversion Functions ---
def to_mib(value: Any) -> Any:
    """Converts GB to MiB (x1024). Handles strings/floats."""
    try:
        if value is None or value == "":
            return ""
        return float(value) * 1024
    except (ValueError, TypeError):
        return value

def to_int(value: Any) -> Any:
    try:
        if value is None or value == "":
            return ""
        return int(float(value))
    except (ValueError, TypeError):
        return value

def no_op(value: Any) -> Any:
    return value

# --- Target Column Definitions (from RVTOOLEX.xlsx reference) ---
# Only for the requested sheets: vHost, vCPU, vMemory, vDisk, vCluster, vDatastore, vSC_VMK, vNIC

RVTOOLS_HEADERS = {
    "vHost": [
        "Host", "Datacenter", "Cluster", "Config status", "Compliance Check State",
        "in Maintenance Mode", "in Quarantine Mode", "vSAN Fault Domain Name", "CPU Model",
        "Speed", "HT Available", "HT Active", "# CPU", "Cores per CPU", "# Cores",
        "CPU usage %", "# Memory", "Memory Tiering Type", "Memory usage %", "Console",
        "# NICs", "# HBAs", "# VMs total", "# VMs", "VMs per Core", "# vCPUs",
        "vCPUs per Core", "vRAM", "VM Used memory", "VM Memory Swapped", "VM Memory Ballooned",
        "VMotion support", "Storage VMotion support", "Current EVC", "Max EVC",
        "Assigned License(s)", "ATS Heartbeat", "ATS Locking", "Current CPU power man. policy",
        "Supported CPU power man.", "Host Power Policy", "ESX Version", "Boot time",
        "DNS Servers", "DHCP", "Domain", "Domain List", "DNS Search Order", "NTP Server(s)",
        "NTPD running", "Time Zone", "Time Zone Name", "GMT Offset", "Vendor", "Model",
        "Serial number", "Service tag", "OEM specific string", "BIOS Vendor", "BIOS Version",
        "BIOS Date", "Certificate Issuer", "Certificate Start Date", "Certificate Expiry Date",
        "Certificate Status", "Certificate Subject", "Object ID", "AutoDeploy.MachineIdentity",
        "Backup status", "ClusterInvariantVMMId", "Last backup", "UUID", "VI SDK Server",
        "VI SDK UUID"
    ],
    "vCPU": [
        "VM", "Powerstate", "Template", "SRM Placeholder", "CPUs", "Sockets",
        "Cores p/s", "Max", "Overall", "Level", "Shares", "Reservation", "Entitlement",
        "DRS Entitlement", "Limit", "Hot Add", "Hot Remove", "Numa Hotadd Exposed",
        "Annotation", "Backup status", "ClusterInvariantVMMId", "Last backup",
        "Datacenter", "Cluster", "Host", "Folder", "OS according to the configuration file",
        "OS according to the VMware Tools", "VM ID", "VM UUID", "VI SDK Server", "VI SDK UUID"
    ],
    "vMemory": [
        "VM", "Powerstate", "Template", "SRM Placeholder", "Size MiB",
        "Memory Reservation Locked To Max", "Overhead", "Max", "Consumed",
        "Consumed Overhead", "Private", "Shared", "Swapped", "Ballooned", "Active",
        "Entitlement", "DRS Entitlement", "Level", "Shares", "Reservation", "Limit",
        "Hot Add", "Annotation", "Backup status", "ClusterInvariantVMMId", "Last backup",
        "Datacenter", "Cluster", "Host", "Folder", "OS according to the configuration file",
        "OS according to the VMware Tools", "VM ID", "VM UUID", "VI SDK Server", "VI SDK UUID"
    ],
    "vDisk": [
        "VM", "Powerstate", "Template", "SRM Placeholder", "Disk", "Disk Key",
        "Disk UUID", "Disk Path", "Capacity MiB", "Raw", "Disk Mode", "Sharing mode",
        "Thin", "Eagerly Scrub", "Split", "Write Through", "Level", "Shares",
        "Reservation", "Limit", "Controller", "Label", "SCSI Unit #", "Unit #",
        "Shared Bus", "Path", "Raw LUN ID", "Raw Comp. Mode", "Internal Sort Column",
        "Annotation", "Backup status", "ClusterInvariantVMMId", "Last backup",
        "Datacenter", "Cluster", "Host", "Folder", "OS according to the configuration file",
        "OS according to the VMware Tools", "VM ID", "VM UUID", "VI SDK Server", "VI SDK UUID"
    ],
    "vCluster": [
        "Name", "Config status", "OverallStatus", "NumHosts", "numEffectiveHosts",
        "TotalCpu", "NumCpuCores", "NumCpuThreads", "Effective Cpu", "TotalMemory",
        "Effective Memory", "Num VMotions", "HA enabled", "Failover Level",
        "AdmissionControlEnabled", "Host monitoring", "HB Datastore Candidate Policy",
        "Isolation Response", "Restart Priority", "Cluster Settings", "Max Failures",
        "Max Failure Window", "Failure Interval", "Min Up Time", "VM Monitoring",
        "DRS enabled", "DRS default VM behavior", "DRS vmotion rate", "DPM enabled",
        "DPM default behavior", "DPM Host Power Action Rate", "Object ID",
        "Backup status", "ClusterInvariantVMMId",
        "com.vmware.vcenter.cluster.edrs.upgradeHostAdded", "Last backup",
        "VI SDK Server", "VI SDK UUID"
    ],
    "vDatastore": [
        "Name", "Config status", "Address", "Accessible", "Type", "# VMs total",
        "# VMs", "Capacity MiB", "Provisioned MiB", "In Use MiB", "Free MiB", "Free %",
        "SIOC enabled", "SIOC Threshold", "# Hosts", "Hosts", "Cluster name",
        "Cluster capacity MiB", "Cluster free space MiB", "Block size", "Max Blocks",
        "# Extents", "Major Version", "Version", "VMFS Upgradeable", "MHA", "URL",
        "Object ID", "Backup status", "ClusterInvariantVMMId", "Last backup",
        "VI SDK Server", "VI SDK UUID"
    ],
    "vSC_VMK": [
        "Host", "Datacenter", "Cluster", "Port Group", "Device", "Mac Address",
        "DHCP", "IP Address", "IP 6 Address", "Subnet mask", "Gateway",
        "IP 6 Gateway", "MTU", "VI SDK Server", "VI SDK UUID"
    ],
    "vNIC": [
        "Host", "Datacenter", "Cluster", "Network Device", "Driver", "Speed",
        "Duplex", "MAC", "Switch", "Uplink port", "PCI", "WakeOn",
        "VI SDK Server", "VI SDK UUID"
    ],
    "vSnapshot": [
        "VM", "Powerstate", "Name", "Description", "Date / time", "Filename",
        "Size MiB (vmsn)", "Size MiB (total)", "Quiesced", "State", "Annotation",
        "Backup status", "ClusterInvariantVMMId", "Last backup", "Datacenter",
        "Cluster", "Host", "Folder", "OS according to the configuration file",
        "OS according to the VMware Tools", "VM ID", "VM UUID", "VI SDK Server",
        "VI SDK UUID"
    ],
    "vCD": [
        "VM", "Powerstate", "Template", "SRM Placeholder", "Device Node",
        "Connected", "Starts Connected", "Device Type", "Annotation",
        "Backup status", "ClusterInvariantVMMId", "Last backup", "Datacenter",
        "Cluster", "Host", "Folder", "OS according to the configuration file",
        "OS according to the VMware Tools", "VMRef", "VM ID", "VM UUID",
        "VI SDK Server", "VI SDK UUID"
    ],
    "vInfo": [
        "VM", "Powerstate", "Template", "SRM Placeholder", "Config status",
        "DNS Name", "Connection state", "Guest state", "Heartbeat",
        "Consolidation Needed", "PowerOn", "Suspended To Memory", "Suspend time",
        "Suspend Interval", "Creation date", "Change Version", "CPUs",
        "Overall Cpu Readiness", "Memory", "Active Memory", "NICs", "Disks",
        "Total disk capacity MiB", "Fixed Passthru HotPlug",
        "min Required EVC Mode Key", "Latency Sensitivity", "Op Notification Timeout",
        "EnableUUID", "CBT", "Primary IP Address", "Network #1", "Network #2",
        "Network #3", "Network #4", "Network #5", "Network #6", "Network #7",
        "Network #8", "Num Monitors", "Video Ram KiB", "Resource pool",
        "Folder ID", "Folder", "vApp", "DAS protection", "FT State", "FT Role",
        "FT Latency", "FT Bandwidth", "FT Sec. Latency", "Vm Failover In Progress",
        "Provisioned MiB", "In Use MiB", "Unshared MiB", "HA Restart Priority",
        "HA Isolation Response", "HA VM Monitoring", "Cluster rule(s)",
        "Cluster rule name(s)", "Boot Required", "Boot delay", "Boot retry delay",
        "Boot retry enabled", "Boot BIOS setup", "Reboot PowerOff",
        "EFI Secure boot", "Firmware", "HW version", "HW upgrade status",
        "HW upgrade policy", "HW target", "Path", "Log directory",
        "Snapshot directory", "Suspend directory", "Annotation", "Backup status",
        "ClusterInvariantVMMId", "Last backup", "Datacenter", "Cluster", "Host",
        "OS according to the configuration file", "OS according to the VMware Tools",
        "Customization Info", "Guest Detailed Data", "VM ID", "SMBIOS UUID",
        "VM UUID", "VI SDK Server type", "VI SDK API Version", "VI SDK Server",
        "VI SDK UUID"
    ],
    "vNetwork": [
        "VM", "Powerstate", "Template", "SRM Placeholder", "NIC label", "Adapter",
        "Network", "Switch", "Connected", "Starts Connected", "Mac Address",
        "Type", "IPv4 Address", "IPv6 Address", "Direct Path IO",
        "Internal Sort Column", "Annotation", "Backup status",
        "ClusterInvariantVMMId", "Last backup", "Datacenter", "Cluster", "Host",
        "Folder", "OS according to the configuration file",
        "OS according to the VMware Tools", "VM ID", "VM UUID", "VI SDK Server",
        "VI SDK UUID"
    ],
    "vTools": [
        "VM", "Powerstate", "Template", "SRM Placeholder", "VM Version",
        "Tools", "Tools Version", "Required Version", "Upgradeable",
        "Upgrade Policy", "Sync time", "App status", "Heartbeat status",
        "Kernel Crash state", "Operation Ready", "State change support",
        "Interactive Guest", "Annotation", "Backup status",
        "ClusterInvariantVMMId", "Last backup", "Datacenter", "Cluster", "Host",
        "Folder", "OS according to the configuration file",
        "OS according to the VMware Tools", "VMRef", "VM ID", "VM UUID",
        "VI SDK Server", "VI SDK UUID"
    ],
    "vSwitch": [
        "Host", "Datacenter", "Cluster", "Switch", "# Ports", "Free Ports",
        "Promiscuous Mode", "Mac Changes", "Forged Transmits", "Traffic Shaping",
        "Width", "Peak", "Burst", "Policy", "Reverse Policy", "Notify Switch",
        "Rolling Order", "Offload", "TSO", "Zero Copy Xmit", "MTU",
        "VI SDK Server", "VI SDK UUID"
    ],
    "vPort": [
        "Host", "Datacenter", "Cluster", "Port Group", "Switch", "VLAN",
        "Promiscuous Mode", "Mac Changes", "Forged Transmits", "Traffic Shaping",
        "Width", "Peak", "Burst", "Policy", "Reverse Policy", "Notify Switch",
        "Rolling Order", "Offload", "TSO", "Zero Copy Xmit", "VI SDK Server",
        "VI SDK UUID"
    ],
    "dvSwitch": [
        "Switch", "Datacenter", "Name", "Vendor", "Version", "Description",
        "Created", "Host members", "Max Ports", "# Ports", "# VMs",
        "In Traffic Shaping", "In Avg", "In Peak", "In Burst",
        "Out Traffic Shaping", "Out Avg", "Out Peak", "Out Burst", "CDP Type",
        "CDP Operation", "LACP Name", "LACP Mode", "LACP Load Balance Alg.",
        "Max MTU", "Contact", "Admin Name", "Object ID", "Backup status",
        "ClusterInvariantVMMId", "Last backup", "VI SDK Server", "VI SDK UUID"
    ],
    "dvPort": [
        "Port", "Switch", "Type", "# Ports", "VLAN", "Speed", "Full Duplex",
        "Blocked", "Allow Promiscuous", "Mac Changes", "Active Uplink",
        "Standby Uplink", "Policy", "Forged Transmits", "In Traffic Shaping",
        "In Avg", "In Peak", "In Burst", "Out Traffic Shaping", "Out Avg",
        "Out Peak", "Out Burst", "Reverse Policy", "Notify Switch",
        "Rolling Order", "Check Beacon", "Live Port Moving", "Check Duplex",
        "Check Error %", "Check Speed", "Percentage", "Block Override",
        "Config Reset", "Shaping Override", "Vendor Config Override",
        "Sec. Policy Override", "Teaming Override", "Vlan Override",
        "Object ID", "VI SDK Server", "VI SDK UUID"
    ],
    "vHBA": [
        "Host", "Datacenter", "Cluster", "Device", "Type", "Status", "Bus",
        "Pci", "Driver", "Model", "WWN", "VI SDK Server", "VI SDK UUID"
    ],
    "vPartition": [
        "VM", "Powerstate", "Template", "SRM Placeholder", "Disk Key", "Disk",
        "Capacity MiB", "Consumed MiB", "Free MiB", "Free %",
        "Internal Sort Column", "Annotation", "Backup status",
        "ClusterInvariantVMMId", "Last backup", "Datacenter", "Cluster", "Host",
        "Folder", "OS according to the configuration file",
        "OS according to the VMware Tools", "VM ID", "VM UUID",
        "VI SDK Server", "VI SDK UUID"
    ],
    "vMultiPath": [
        "Host", "Cluster", "Datacenter", "Datastore", "Disk", "Display name",
        "Policy", "Oper. State", "Path 1", "Path 1 state", "Path 2",
        "Path 2 state", "Path 3", "Path 3 state", "Path 4", "Path 4 state",
        "Path 5", "Path 5 state", "Path 6", "Path 6 state", "Path 7",
        "Path 7 state", "Path 8", "Path 8 state", "vStorage", "Queue depth",
        "Vendor", "Model", "Revision", "Level", "Serial #", "UUID",
        "Object ID", "VI SDK Server", "VI SDK UUID"
    ],
    "vMetaData": [
        "RVTools major version", "RVTools version", "xlsx creation datetime",
        "Server"
    ],
    "vSource": [
        "Name", "OS type", "API type", "API version", "Version", "Patch level",
        "Build", "Fullname", "Product name", "Product version", "Product line",
        "Vendor", "VI SDK Server", "VI SDK UUID"
    ],
    "vLicense": [
        "Name", "Key", "Labels", "Cost Unit", "Total", "Used",
        "Expiration Date", "Features", "VI SDK Server", "VI SDK UUID"
    ],
    "vRP": [
        "Resource Pool name", "Resource Pool path", "Status", "# VMs total",
        "# VMs", "# vCPUs", "CPU limit", "CPU overheadLimit", "CPU reservation",
        "CPU level", "CPU shares", "CPU expandableReservation", "CPU maxUsage",
        "CPU overallUsage", "CPU reservationUsed", "CPU reservationUsedForVm",
        "CPU unreservedForPool", "CPU unreservedForVm", "Mem Configured",
        "Mem limit", "Mem overheadLimit", "Mem reservation", "Mem level",
        "Mem shares", "Mem expandableReservation", "Mem maxUsage",
        "Mem overallUsage", "Mem reservationUsed", "Mem reservationUsedForVm",
        "Mem unreservedForPool", "Mem unreservedForVm", "QS overallCpuDemand",
        "QS overallCpuUsage", "QS staticCpuEntitlement",
        "QS distributedCpuEntitlement", "QS balloonedMemory",
        "QS compressedMemory", "QS consumedOverheadMemory",
        "QS distributedMemoryEntitlement", "QS guestMemoryUsage",
        "QS hostMemoryUsage", "QS overheadMemory", "QS privateMemory",
        "QS sharedMemory", "QS staticMemoryEntitlement", "QS swappedMemory",
        "Object ID", "VI SDK Server", "VI SDK UUID"
    ],
    "vHealth": [
        "Name", "Message", "Message type", "VI SDK Server", "VI SDK UUID"
    ],
    "vUSB": [
        "VM", "Powerstate", "Template", "SRM Placeholder", "Device Node",
        "Device Type", "Connected", "Family", "Speed", "EHCI enabled",
        "Auto connect", "Bus number", "Unit number", "Annotation",
        "Backup status", "ClusterInvariantVMMId", "Last backup", "Datacenter",
        "Cluster", "Host", "Folder", "OS according to the configuration file",
        "OS according to the VMware tools", "VMRef", "VM ID", "VM UUID",
        "VI SDK Server", "VI SDK UUID"
    ],
    "vFileInfo": [
        "Friendly Path Name", "File Name", "File Type", "File Size in bytes",
        "Path", "Internal Sort Column", "VI SDK Server", "VI SDK UUID"
    ]
}

# --- Mapping Definitions ---
# Format: "TargetCol": ("SourceCol", ConversionFunc) or "TargetCol": "SourceCol"
# If SourceCol is missing in input, TargetCol will be empty.

MAPPINGS = {
    "vInfo": {
        "VM": "VM",
        "Powerstate": "Powerstate",
        "Template": "Template",
        "DNS Name": "DNSName",
        "CPUs": "CPUs", # Updated key in collector
        "Memory": "Memory", # Updated key in collector
        "Primary IP Address": "Primary IP",
        "Annotation": "Annotation",
        "Datacenter": "Datacenter",
        "Cluster": "Cluster",
        "Host": "Host",
        "OS according to the configuration file": "OS",
        "VM UUID": "VMUUID",
        "VI SDK UUID": "InstanceUUID",
        # New Mappings
        "Connection state": "Connection state",
        "Guest state": "Guest state",
        "Heartbeat": "Heartbeat",
        "Consolidation Needed": "Consolidation Needed",
        "Creation date": "Creation date",
        "Change Version": "Change Version",
        "Active Memory": "Active Memory",
        "NICs": "NICs",
        "Disks": "Disks",
        "Provisioned MiB": "Provisioned MiB",
        "In Use MiB": "In Use MiB",
        "Folder": "Folder",
        "Resource pool": "Resource pool",
        "Path": "Path",
        "Log directory": "Log directory",
        "Snapshot directory": "Snapshot directory",
        "Suspend directory": "Suspend directory",
        "SMBIOS UUID": "SMBIOS UUID",
        "Tools Version": "ToolsVersion" # vTools? No this is vInfo.
    },
    "vNetwork": {
        "Host": "Host",
        "Datacenter": "Datacenter",
        "Cluster": "Cluster",
        "Device": "Device",
        "Type": "Type",
        "Status": "Status",
        "Bus": "Bus",
        "Pci": "Pci",
        "Driver": "Driver",
        "Model": "Model",
        "WWN": "WWN"
    },
    "vPartition": {
        "VM": "VM",
        "Powerstate": "Powerstate",
        "Template": "Template",
        "Disk": "Disk",
        "Capacity MiB": "Capacity MiB",
        "Consumed MiB": "Consumed MiB",
        "Free MiB": "Free MiB",
        "Free %": "Free %",
        "Datacenter": "Datacenter",
        "Cluster": "Cluster",
        "Host": "Host"
    },
    "vMultiPath": {
        "Host": "Host",
        "Cluster": "Cluster",
        "Datacenter": "Datacenter",
        "Disk": "Device",
        "Policy": "Policy",
        # Paths are mapped automatically if keys match header names (Path 1, Path 1 state...)
    },
    "vMetaData": {
        "RVTools major version": "ExporterVersion", # Will be full version string
        "RVTools version": "ExporterVersion",
        "xlsx creation datetime": "GeneratedAt",
        "Server": "Server"
    },
    "vSource": {
        "Name": "SourceName",
        "OS type": "SourceType",
        "API type": "SourceType", # Mapped from collector SourceType which is API Type
        "API version": "ApiVersion",
        "Version": "ApiVersion",
        "Build": "ApiBuild",
        "VI SDK Server": "SourceName",
        "VI SDK UUID": "InstanceUuid"
    },
    "vLicense": {
        "Name": "Name",
        "Key": "LicenseKey",
        "Total": "Total",
        "Used": "Used",
        "Expiration Date": "Expiration",
        "Labels": "Product", # Mapping Product to Labels? Or maybe leave Labels empty and put Product in Features? Let's check RVTools behavior. Usually Name is Product.
        # "Cost Unit": "Unit"
    },
    "vRP": {
        "Resource Pool name": "ResourcePool",
        "Resource Pool path": "Parent", # Usually hierarchical path, but we have Parent name.
        "CPU reservation": "CPU_Reservation",
        "CPU limit": "CPU_Limit",
        "CPU shares": "CPU_Shares",
        "Mem reservation": "Memory_Reservation",
        "Mem limit": "Memory_Limit",
        "Mem shares": "Memory_Shares",
        "Cluster": "Cluster",
        "Datacenter": "Datacenter"
    },
    "vHealth": {
        "Name": "Entity",
        "Message": "Summary", # Mapping Summary to Message
        "Message type": "Status" # Mapping Status (Green/Red) to Message type?
    },
    "vUSB": {
        "VM": "VM",
        "Device Node": "Device",
        "Connected": "Connected",
        "Auto connect": "AutoConnect",
        "Speed": "Speed",
        "Family": "VendorId", # VendorId map to Family?
        # "Unit number": "UnitNumber"
    },
    "vFileInfo": {
        "Path": "Path",
        "Friendly Path Name": "Datastore", # Maybe?
        "File Size in bytes": ("SizeGB", lambda x: int(float(x)*1024*1024*1024) if x else 0), # GB to Bytes
        "File Type": "Type",
        "File Name": "Path" # Path usually contains filename
    },
    "dvSwitch": {
        "Switch": "dvSwitch",
        "Datacenter": "Datacenter",
        "Version": "Version",
        "# Ports": "NumPorts",
        "Max MTU": "MTU",
        "Host members": "Uplinks", # Mapping Uplinks count or list here?
    },
    "dvPort": {
        "Port": "PortGroup", # Mapping PortGroup name to Port column
        "Switch": "dvSwitch",
        "VLAN": "VLAN",
        "# Ports": "NumPorts",
        "Type": "Type"
    },
    "vSwitch": {
        "Host": "Host",
        "Datacenter": "Datacenter",
        "Cluster": "Cluster",
        "Switch": "vSwitch",
        "# Ports": "NumPorts",
        "MTU": "MTU",
        "Promiscuous Mode": "Promiscuous",
        "Mac Changes": "MACChanges",
        "Forged Transmits": "ForgedTransmits",
    },
    "vPort": {
        "Host": "Host",
        "Datacenter": "Datacenter",
        "Cluster": "Cluster",
        "Port Group": "PortGroup",
        "Switch": "vSwitch",
        "VLAN": "VLAN",
        "Promiscuous Mode": "Promiscuous",
        "Mac Changes": "MACChanges",
        "Forged Transmits": "ForgedTransmits",
        "Traffic Shaping": "TrafficShaping"
    },
    "vNetwork": {
        "VM": "VM",
        "Powerstate": "Powerstate",
        "Template": "Template",
        "Adapter": "Adapter",
        "Network": "Network",
        "Mac Address": "MAC",
        "Type": "Type",
        "Connected": "Connected",
        "Starts Connected": "Starts Connected",
        "Switch": "Switch", # Will be empty unless we have it
        "Datacenter": "Datacenter",
        "Cluster": "Cluster",
        "Host": "Host",
        # "IPv4 Address": "IPAddress", # Collector doesn't return IPAddress yet? I didn't see it in vnetwork.py
    },
    "vTools": {
        "VM": "VM",
        "Powerstate": "Powerstate",
        "Template": "Template",
        "Tools": "ToolsStatus", # Mapping status to "Tools" col which is usually status text
        "Datacenter": "Datacenter",
        "Cluster": "Cluster",
        "Host": "Host",
        # "Tools Version": "ToolsVersion", # Not collected?
        # "Upgrade Policy": "UpgradePolicy" # Not collected?
    },
    "vHost": {
        "Host": "Host",
        "Datacenter": "Datacenter",
        "Cluster": "Cluster",
        "ConnectionState": "ConnectionState", # Note: RVTools uses "Config status" sometimes or implicit? Check ref. keeping closest.
        # Ref "Config status" != "ConnectionState", but we can map ConnectionState to something or leave empty.
        # Let's map strict equivalents found in collector.
        "Model": "Model",
        "CPU Model": "CPU_Model",
        "# CPU": ("CPU_Sockets", to_int),
        "# Cores": ("CPU_Cores", to_int),
        "# Memory": ("Memory_GB", to_mib), # GB -> MiB
        "ESX Version": "Version",
        # "Build": "Build", # RVTools doesn't have explicit "Build" col in vHost? Check ref. It's not in the list above.
        # Ref list above has "ESX Version".
    },
    "vCD": {
        "VM": "VM",
        "Device Node": "Device", # e.g. "CD/DVD drive 1"
        "Connected": "Connected",
        "Starts Connected": "StartConnected",
        "Device Type": "ISOPath", # RVTools puts ISO path or "Remote Device" here usually? Let's map ISOPath here for visibility
    },
    "vSnapshot": {
        "VM": "VM",
        "Name": "SnapshotName",
        "Description": "Description",
        "Date / time": "Created",
        "Quiesced": "Quiesced",
        "State": "State",
        # Size is hard to get without extensive traversal, leaving empty for now or mapping if I had it
        # "Size MiB (total)": "SizeGB" -> to_mib
    },
    "vCPU": {
        "VM": "VM",
        "CPUs": "CPUs",
        "Sockets": "CPUs", # Approx if not strictly sockets
        "Cores p/s": "CoresPerSocket",
        "Reservation": "vCPU_Reservation",
        "Limit": "vCPU_Limit",
        "Shares": "vCPU_Shares",
        "Hot Add": "CPU_HotAdd",
        # "Level": "Level"
    },
    "vMemory": {
        "VM": "VM",
        "Size MiB": "MemoryMB", # Assuming collected is MB
        "Reservation": "Memory_Reservation",
        "Limit": "Memory_Limit",
        "Shares": "Memory_Shares",
        "Hot Add": "Memory_HotAdd",
        "Consumed": "Consumed_MB",
        "Swapped": "Swapped_MB",
        "Ballooned": "Ballooned_MB",
    },
    "vDisk": {
        "VM": "VM",
        "Disk": "Disk",
        "Datastore": "Datastore", # Note: RVTools vDisk has "Datastore" col? Yes.
        "Capacity MiB": ("CapacityGB", to_mib),
        "Provisioned MiB": ("ProvisionedGB", to_mib), # RVTools has "Provisioned MiB" usually not in vDisk but implied? Ref says vDisk has "Capacity MiB".
        # Check vDisk ref headers: "Capacity MiB".
        "Path": "File",
        "Thin": "Thin",
        "Controller": "Controller",
        "Unit #": "UnitNumber",
        "Disk Mode": "Type", # Approx
    },
    "vCluster": {
        "Name": "Cluster",
        "TotalCpu": "TotalCPU_MHz",
        "TotalMemory": ("TotalMemory_GB", to_mib),
        "NumHosts": "NumHosts",
        "HA enabled": "HA_Enabled",
        "DRS enabled": "DRS_Enabled",
    },
    "vDatastore": {
        "Name": "Datastore",
        "Type": "Type",
        "Capacity MiB": ("CapacityGB", to_mib),
        "Free MiB": ("FreeGB", to_mib),
        "In Use MiB": ("UsedGB", to_mib), # Calculated
        "Accessible": "Accessible",
        "URL": "URL",
    },
    "vSC_VMK": {
        "Host": "Host",
        "Device": "VMkernel",
        "Port Group": "PortGroup",
        "IP Address": "IP",
        "Subnet mask": "Subnet",
        "MTU": "MTU",
        "Mac Address": "MAC",
    },
    "vNIC": {
        "Host": "Host",
        "Network Device": "vNIC",
        "MAC": "MAC",
        "Driver": "Driver",
        "PCI": "PCI",
        "Speed": "Speed", # This might need split if user wants separate. For now map direct.
    }
}


def apply_compatibility(sheet_name: str, rows: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[str]]:
    """
    Transforms rows to match RVTools schema.
    Returns (new_rows, new_headers).
    If sheet not in RVTOOLS_HEADERS, returns original rows and inferred headers.
    """
    if sheet_name not in RVTOOLS_HEADERS:
        # Pass through for non-implemented sheets
        headers = []
        if rows:
            headers = list(rows[0].keys())
        return rows, headers

    target_headers = RVTOOLS_HEADERS[sheet_name]
    sheet_mapping = MAPPINGS.get(sheet_name, {})
    
    new_rows = []
    
    for row in rows:
        new_row = {}
        for header in target_headers:
            # Determine value
            val = ""
            
            # check mapping
            mapping = sheet_mapping.get(header)
            
            source_key = None
            converter = no_op
            
            if isinstance(mapping, tuple):
                source_key, converter = mapping
            elif isinstance(mapping, str):
                source_key = mapping
            
            if source_key and source_key in row:
                raw_val = row[source_key]
                val = converter(raw_val)
            
            # Fallback: if header name matches exactly in source (and not mapped explicitly), take it
            if val == "" and header in row and header not in sheet_mapping:
                 val = row[header]
            
            new_row[header] = val
            
        new_rows.append(new_row)
        
    return new_rows, target_headers
