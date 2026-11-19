"""Roles and what each may do. Kept in code so the rules are reviewable in one place."""

OWNER, MANAGER, CASHIER, PURCHASER, AUDITOR = "owner", "manager", "cashier", "purchaser", "auditor"
ROLE_CHOICES = [
    (OWNER, "Owner"),
    (MANAGER, "Manager"),
    (CASHIER, "Cashier"),
    (PURCHASER, "Purchaser"),
    (AUDITOR, "Auditor (read-only)"),
]

PERMISSIONS = {
    "bill": "Use the billing counter",
    "price_override": "Change a selling price at the counter",
    "discount_approve": "Give a manual discount",
    "cancel_bill": "Cancel a bill in progress",
    "refund": "Issue refunds / returns",
    "credit_sale": "Sell on customer credit",
    "write_off": "Write off damaged / expired / wasted stock",
    "stock_view": "View stock and lots",
    "stocktake": "Count stock",
    "stocktake_approve": "Approve stocktake adjustments",
    "products": "Create and edit products, prices and barcodes",
    "link_barcode": "Link an unknown barcode to a product",
    "purchase": "Purchase orders, goods receipts, supplier returns",
    "supplier_pay": "Record supplier payments",
    "customers": "Customer profiles",
    "expenses": "Record expenses",
    "cash": "Open / close own cashier shift, cash in/out",
    "reopen_shift": "Reopen a closed shift",
    "settlement": "UPI / card settlement reconciliation",
    "reports": "Reports and owner dashboard",
    "audit_view": "View the audit log",
    "settings": "Store, invoice and hardware settings",
    "users": "Staff accounts and roles",
    "backup": "Backups and restore checks",
    "offers": "Offers and promotions",
}

ROLE_PERMS = {
    OWNER: set(PERMISSIONS),
    MANAGER: set(PERMISSIONS) - {"settings", "users"},
    CASHIER: {"bill", "cancel_bill", "customers", "cash", "stock_view"},
    PURCHASER: {"stock_view", "stocktake", "products", "link_barcode", "purchase", "write_off"},
    AUDITOR: {"stock_view", "reports", "audit_view", "settlement"},
}
READ_ONLY_ROLES = {AUDITOR}


def perms_for(user):
    if user is None or not user.is_authenticated or not user.is_active:
        return set()
    if user.is_superuser:
        return set(PERMISSIONS)
    return ROLE_PERMS.get(user.role, set())
