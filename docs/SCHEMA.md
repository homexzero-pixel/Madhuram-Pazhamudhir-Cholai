# Database schema

Generated from the Django models (`scripts/generate_docs.py`). SQLite file, one per mode (store / practice). Money: DECIMAL(…,2) rupees. Quantities: DECIMAL(…,3) (kg to the gram). All changes go through migrations in each app's `migrations/` folder.

## core_storesettings  (StoreSettings)
One row. Shop identity, invoice series and counter hardware settings.

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| name | CharField |  |
| name_ta | CharField |  |
| legal_name | CharField |  |
| tagline | CharField |  |
| address | TextField |  |
| phone | CharField |  |
| email | CharField |  |
| gstin | CharField |  |
| state_name | CharField |  |
| state_code | CharField |  |
| fssai | CharField |  |
| invoice_prefix | CharField | Bill number = PREFIX/FY/00001, at most 16 characters. |
| credit_note_prefix | CharField |  |
| bill_footer | CharField |  |
| receipt_width | CharField |  |
| auto_print | BooleanField | Open the print dialog as soon as a bill is saved. |
| require_tax_setup | BooleanField | Block billing of items whose GST treatment is not set. Turn on after the accountant has reviewed tax data. |
| scale_enabled | BooleanField |  |
| scale_prefixes | CharField | Comma-separated leading digits that mark a scale label. |
| scale_item_start | PositiveSmallIntegerField | Position (0-based) where the item code starts. |
| scale_item_length | PositiveSmallIntegerField |  |
| scale_value_start | PositiveSmallIntegerField |  |
| scale_value_length | PositiveSmallIntegerField |  |
| scale_value_type | CharField |  |
| scale_value_decimals | PositiveSmallIntegerField |  |
| scale_check_digit | BooleanField | Validate the EAN-13 check digit. |
| scale_label_length | PositiveSmallIntegerField |  |
| scanner_note | CharField |  |
| printer_note | CharField |  |
| scale_note | CharField |  |
| hardware_tested | CharField | Record each device only after a physical test, e.g. 'Scanner XYZ tested 12-Dec by Priya'. |
| loyalty_enabled | BooleanField |  |
| loyalty_rupees_per_point | DecimalField(8,2) | ₹ spent for 1 point. |
| loyalty_point_value | DecimalField(6,2) | ₹ value of 1 point when redeemed. |
| near_expiry_days | PositiveSmallIntegerField |  |
| dead_stock_days | PositiveSmallIntegerField |  |
| backup_keep | PositiveSmallIntegerField | Automatic backups to keep. |
| backup_extra_dir | CharField | Optional second folder (USB drive / network share) for backup copies. |
| is_demo | BooleanField |  |
| updated_at | DateTimeField |  |

## core_sequence  (Sequence)
Gap-free counters for bill and credit-note numbers, one row per series and FY.

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| key | CharField | unique |
| last | PositiveIntegerField |  |

## core_auditlog  (AuditLog)
Who did what. Price changes, approvals, refunds, write-offs, shift reopen, etc.

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| at | DateTimeField | indexed |
| user_id | → accounts_user | indexed; nullable |
| approved_by_id | → accounts_user | indexed; nullable |
| action | CharField | indexed |
| object_type | CharField |  |
| object_id | CharField |  |
| summary | CharField |  |
| data | JSONField |  |

## accounts_user  (User)

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| password | CharField |  |
| last_login | DateTimeField | nullable |
| is_superuser | BooleanField | Designates that this user has all permissions without explicitly assigning them. |
| username | CharField | unique; Required. 150 characters or fewer. Letters, digits and @/./+/-/_ only. |
| first_name | CharField |  |
| last_name | CharField |  |
| email | CharField |  |
| is_staff | BooleanField | Designates whether the user can log into this admin site. |
| is_active | BooleanField | Designates whether this user should be treated as active. Unselect this instead of deleting accounts. |
| date_joined | DateTimeField |  |
| role | CharField |  |
| name_ta | CharField |  |
| phone | CharField |  |
| approval_pin | CharField | Hashed 4-6 digit PIN used to approve actions at the counter. |

## catalog_department  (Department)

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| name | CharField | unique |
| name_ta | CharField |  |

## catalog_category  (Category)

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| department_id | → catalog_department | indexed |
| name | CharField |  |
| name_ta | CharField |  |

Constraints: department, name

## catalog_baseproduct  (BaseProduct)
What the item is (e.g. 'Ponni rice'), shared by all its packs and brands.

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| name | CharField | unique |
| name_ta | CharField |  |
| category_id | → catalog_category | indexed |
| subcategory | CharField |  |

## catalog_item  (Item)
A sellable SKU: one brand, variant and pack size with its own price and stock.

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| sku | CharField | unique |
| plu | CharField | unique; nullable; Short code for loose produce and scale labels. |
| base_id | → catalog_baseproduct | indexed |
| name | CharField | indexed |
| name_ta | CharField | indexed |
| brand | CharField | indexed |
| variant | CharField |  |
| pack_size | CharField |  |
| department_id | → catalog_department | indexed |
| category_id | → catalog_category | indexed |
| subcategory | CharField |  |
| sale_unit | CharField |  |
| purchase_unit | CharField | e.g. carton, bag, crate, kg |
| units_per_purchase | DecimalField(10,3) | Sale units in one purchase unit, e.g. 24 bottles per carton. |
| mrp | DecimalField(10,2) | nullable |
| cost | DecimalField(10,2) | nullable; Latest cost per sale unit. |
| price | DecimalField(10,2) | nullable; Per piece, or per kg for weighed items. GST inclusive. |
| hsn | CharField |  |
| tax_class | CharField |  |
| gst_rate | DecimalField(5,2) | nullable |
| preferred_supplier_id | → purchasing_supplier | indexed; nullable |
| reorder_level | DecimalField(10,3) |  |
| shelf | CharField |  |
| track_batch | BooleanField |  |
| track_expiry | BooleanField |  |
| is_active | BooleanField | indexed |
| status | CharField |  |
| on_hand | DecimalField(12,3) | Sellable stock. Kept equal to the sum of sellable lots. |
| created_at | DateTimeField |  |
| updated_at | DateTimeField |  |

Extra indexes: category, is_active

## catalog_barcode  (Barcode)
A scannable code. Text, so leading zeros survive. One code -> exactly one item.

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| code | CharField | unique |
| item_id | → catalog_item | indexed |
| kind | CharField |  |
| qty_per_scan | DecimalField(10,3) | Units added per scan, e.g. 24 for a carton barcode of a bottle SKU. |
| note | CharField |  |
| created_at | DateTimeField |  |

## catalog_importbatch  (ImportBatch)
One applied product import. Keeps the previous values so it can be undone.

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| created_at | DateTimeField |  |
| user_id | → accounts_user | indexed |
| filename | CharField |  |
| created_items | PositiveIntegerField |  |
| updated_items | PositiveIntegerField |  |
| barcodes_added | PositiveIntegerField |  |
| undo | JSONField |  |
| undone_at | DateTimeField | nullable |

## inventory_stocklot  (StockLot)
One delivery (or opening count) of one item. Each lot keeps its own batch, expiry and cost.

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| item_id | → catalog_item | indexed |
| batch | CharField |  |
| expiry | DateField | indexed; nullable |
| received_qty | DecimalField(12,3) |  |
| qty | DecimalField(12,3) |  |
| unit_cost | DecimalField(12,4) | Actual cost per sale unit, after free goods. |
| status | CharField |  |
| received_at | DateTimeField |  |
| source | CharField | GRN / opening / return reference |
| supplier_id | → purchasing_supplier | indexed; nullable |
| grn_line_id | → purchasing_grnline | indexed; nullable |
| origin_id | → inventory_stocklot | indexed; nullable |

Constraints: lot_qty_not_negative

Extra indexes: item, status, expiry

## inventory_stockmove  (StockMove)
Append-only stock ledger. Every change to a lot is one row here.

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| at | DateTimeField | indexed |
| item_id | → catalog_item | indexed |
| lot_id | → inventory_stocklot | indexed |
| kind | CharField | indexed |
| qty | DecimalField(12,3) | + in, − out |
| unit_cost | DecimalField(12,4) |  |
| ref | CharField | indexed |
| reason | CharField |  |
| user_id | → accounts_user | indexed; nullable |
| approved_by_id | → accounts_user | indexed; nullable |

## inventory_stockcount  (StockCount)

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| title | CharField |  |
| created_at | DateTimeField |  |
| created_by_id | → accounts_user | indexed |
| status | CharField |  |
| approved_by_id | → accounts_user | indexed; nullable |
| approved_at | DateTimeField | nullable |

## inventory_stockcountline  (StockCountLine)

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| count_id | → inventory_stockcount | indexed |
| item_id | → catalog_item | indexed |
| lot_id | → inventory_stocklot | indexed; nullable |
| expected | DecimalField(12,3) |  |
| counted | DecimalField(12,3) | nullable |
| reason | CharField |  |

## purchasing_supplier  (Supplier)

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| name | CharField | unique |
| phone | CharField |  |
| gstin | CharField |  |
| address | CharField |  |
| payment_terms_days | PositiveSmallIntegerField |  |
| opening_balance | DecimalField(12,2) | Amount owed to the supplier when you started using this system. |
| is_active | BooleanField |  |
| notes | CharField |  |

## purchasing_purchaseorder  (PurchaseOrder)

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| number | CharField | unique |
| supplier_id | → purchasing_supplier | indexed |
| ordered_on | DateField |  |
| expected_on | DateField | nullable |
| status | CharField |  |
| notes | CharField |  |
| created_by_id | → accounts_user | indexed |

## purchasing_poline  (POLine)

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| order_id | → purchasing_purchaseorder | indexed |
| item_id | → catalog_item | indexed |
| qty | DecimalField(12,3) |  |
| unit_cost | DecimalField(12,2) |  |
| received_qty | DecimalField(12,3) |  |

## purchasing_goodsreceipt  (GoodsReceipt)
GRN: what physically arrived, against a supplier invoice.

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| number | CharField | unique |
| supplier_id | → purchasing_supplier | indexed |
| order_id | → purchasing_purchaseorder | indexed; nullable |
| invoice_no | CharField |  |
| invoice_date | DateField |  |
| invoice_total | DecimalField(12,2) |  |
| received_at | DateTimeField |  |
| received_by_id | → accounts_user | indexed |
| notes | CharField |  |

Constraints: one_grn_per_supplier_invoice

## purchasing_grnline  (GRNLine)

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| grn_id | → purchasing_goodsreceipt | indexed |
| po_line_id | → purchasing_poline | indexed; nullable |
| item_id | → catalog_item | indexed |
| qty | DecimalField(12,3) |  |
| free_qty | DecimalField(12,3) |  |
| damaged_qty | DecimalField(12,3) |  |
| units_per_purchase | DecimalField(10,3) |  |
| unit_cost | DecimalField(12,2) |  |
| batch | CharField |  |
| expiry | DateField | nullable |

## purchasing_purchasereturn  (PurchaseReturn)

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| number | CharField | unique |
| supplier_id | → purchasing_supplier | indexed |
| grn_id | → purchasing_goodsreceipt | indexed; nullable |
| created_at | DateTimeField |  |
| created_by_id | → accounts_user | indexed |
| reason | CharField |  |
| total | DecimalField(12,2) |  |

## purchasing_purchasereturnline  (PurchaseReturnLine)

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| ret_id | → purchasing_purchasereturn | indexed |
| lot_id | → inventory_stocklot | indexed |
| qty | DecimalField(12,3) |  |
| unit_cost | DecimalField(12,4) |  |
| amount | DecimalField(12,2) |  |

## purchasing_supplierpayment  (SupplierPayment)

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| supplier_id | → purchasing_supplier | indexed |
| paid_on | DateField |  |
| amount | DecimalField(12,2) |  |
| method | CharField |  |
| reference | CharField |  |
| shift_id | → sales_shift | indexed; nullable |
| created_by_id | → accounts_user | indexed |
| created_at | DateTimeField |  |

## customers_customer  (Customer)

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| name | CharField |  |
| name_ta | CharField |  |
| phone | CharField | unique; nullable |
| address | CharField |  |
| gstin | CharField |  |
| loyalty_enabled | BooleanField |  |
| credit_allowed | BooleanField |  |
| credit_limit | DecimalField(12,2) |  |
| credit_approved_by_id | → accounts_user | indexed; nullable |
| created_at | DateTimeField |  |
| notes | CharField |  |

## customers_loyaltyentry  (LoyaltyEntry)

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| customer_id | → customers_customer | indexed |
| at | DateTimeField |  |
| points | DecimalField(10,2) | + earned, − redeemed or reversed |
| kind | CharField |  |
| sale_id | → sales_sale | indexed; nullable |
| sale_return_id | → sales_salereturn | indexed; nullable |
| note | CharField |  |

## customers_creditentry  (CreditEntry)
Customer credit ledger. + = customer owes more (credit sale), − = paid or credited.

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| customer_id | → customers_customer | indexed |
| at | DateTimeField |  |
| amount | DecimalField(12,2) |  |
| kind | CharField |  |
| method | CharField | How a payment was received |
| sale_id | → sales_sale | indexed; nullable |
| sale_return_id | → sales_salereturn | indexed; nullable |
| shift_id | → sales_shift | indexed; nullable |
| reference | CharField |  |
| user_id | → accounts_user | indexed; nullable |

## customers_offer  (Offer)
A promotion. Lower priority number is tried first; each bill line gets at most one offer.

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| name | CharField |  |
| kind | CharField |  |
| priority | PositiveSmallIntegerField |  |
| is_active | BooleanField |  |
| starts_on | DateField |  |
| ends_on | DateField |  |
| percent | DecimalField(5,2) | nullable |
| amount | DecimalField(10,2) | nullable; ₹ off per unit, or ₹ off the combo set |
| min_qty | DecimalField(10,3) | nullable; Quantity deal: minimum quantity |
| deal_price | DecimalField(10,2) | nullable; Quantity deal: price per unit when min qty reached |
| created_by_id | → accounts_user | indexed |

## sales_shift  (Shift)

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| counter | CharField |  |
| cashier_id | → accounts_user | indexed |
| business_date | DateField | indexed |
| opened_at | DateTimeField |  |
| opening_float | DecimalField(12,2) |  |
| status | CharField |  |
| closed_at | DateTimeField | nullable |
| closed_by_id | → accounts_user | indexed; nullable |
| counted | DecimalField(12,2) | nullable |
| expected | DecimalField(12,2) | nullable |
| variance | DecimalField(12,2) | nullable |
| denominations | JSONField |  |
| retained_cash | DecimalField(12,2) | nullable |
| close_note | CharField |  |
| reopen_count | PositiveSmallIntegerField |  |

Constraints: one_open_shift_per_counter

## sales_cashmovement  (CashMovement)
Cash put into or taken out of the drawer other than sales, refunds and expenses.

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| shift_id | → sales_shift | indexed |
| at | DateTimeField |  |
| kind | CharField |  |
| amount | DecimalField(12,2) |  |
| reason | CharField |  |
| reference | CharField | Bank deposit slip no. etc. |
| user_id | → accounts_user | indexed |

## sales_draftbill  (DraftBill)
The bill on the counter before payment. Survives a browser refresh or power cut. Its uuid is the idempotency key: a draft can become at most one Sale.

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| uuid | UUIDField | unique |
| cashier_id | → accounts_user | indexed |
| status | CharField | indexed |
| label | CharField |  |
| customer_id | → customers_customer | indexed; nullable |
| created_at | DateTimeField |  |
| updated_at | DateTimeField |  |
| cancel_reason | CharField |  |
| cancelled_by_id | → accounts_user | indexed; nullable |

## sales_draftline  (DraftLine)

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| draft_id | → sales_draftbill | indexed |
| item_id | → catalog_item | indexed |
| qty | DecimalField(12,3) |  |
| source | CharField |  |
| scan_code | CharField |  |
| price_override | DecimalField(10,2) | nullable |
| override_by_id | → accounts_user | indexed; nullable |
| override_reason | CharField |  |
| manual_discount | DecimalField(10,2) |  |
| discount_by_id | → accounts_user | indexed; nullable |
| discount_reason | CharField |  |
| position | PositiveIntegerField |  |

## sales_sale  (Sale)

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| bill_no | CharField | unique |
| draft_uuid | UUIDField | unique; Idempotency key – one draft makes at most one sale. |
| business_date | DateField | indexed |
| created_at | DateTimeField | indexed |
| shift_id | → sales_shift | indexed |
| cashier_id | → accounts_user | indexed |
| customer_id | → customers_customer | indexed; nullable |
| gross | DecimalField(12,2) |  |
| discount | DecimalField(12,2) |  |
| total | DecimalField(12,2) |  |
| doc_type | CharField |  |
| identity | JSONField | Store name, address and GSTIN as printed at the time of sale. |
| points_earned | DecimalField(10,2) |  |
| print_count | PositiveIntegerField |  |

## sales_saleline  (SaleLine)

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| sale_id | → sales_sale | indexed |
| item_id | → catalog_item | indexed |
| sku | CharField |  |
| name | CharField |  |
| name_ta | CharField |  |
| category | CharField |  |
| department | CharField |  |
| unit | CharField |  |
| qty | DecimalField(12,3) |  |
| list_price | DecimalField(10,2) | Catalogue price at sale time |
| rate | DecimalField(10,2) | Price charged per unit (after any override) |
| mrp | DecimalField(10,2) | nullable |
| gross | DecimalField(12,2) |  |
| discount | DecimalField(12,2) |  |
| offer_id | → customers_offer | indexed; nullable |
| discount_note | CharField |  |
| net | DecimalField(12,2) |  |
| tax_class | CharField |  |
| hsn | CharField |  |
| gst_rate | DecimalField(5,2) |  |
| taxable | DecimalField(12,2) |  |
| cgst | DecimalField(12,2) |  |
| sgst | DecimalField(12,2) |  |
| cost | DecimalField(12,2) |  |
| returned_qty | DecimalField(12,3) |  |
| override_by_id | → accounts_user | indexed; nullable |

Constraints: cannot_return_more_than_sold

## sales_salelinelot  (SaleLineLot)

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| line_id | → sales_saleline | indexed |
| lot_id | → inventory_stocklot | indexed |
| qty | DecimalField(12,3) |  |
| unit_cost | DecimalField(12,4) |  |
| returned_qty | DecimalField(12,3) |  |

## sales_settlement  (Settlement)
Money actually credited to the bank for UPI or card payments.

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| method | CharField |  |
| provider | CharField |  |
| settled_on | DateField |  |
| expected | DecimalField(12,2) |  |
| fees | DecimalField(12,2) |  |
| credited | DecimalField(12,2) |  |
| bank_reference | CharField |  |
| notes | CharField |  |
| created_by_id | → accounts_user | indexed |
| created_at | DateTimeField |  |

## sales_payment  (Payment)

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| sale_id | → sales_sale | indexed |
| method | CharField |  |
| amount | DecimalField(12,2) |  |
| tendered | DecimalField(12,2) |  |
| change | DecimalField(12,2) |  |
| reference | CharField | UPI transaction ID / card approval code |
| settlement_id | → sales_settlement | indexed; nullable |

## sales_salereturn  (SaleReturn)
Customer return / credit note.

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| number | CharField | unique |
| sale_id | → sales_sale | indexed |
| business_date | DateField | indexed |
| created_at | DateTimeField |  |
| shift_id | → sales_shift | indexed; nullable |
| user_id | → accounts_user | indexed |
| approved_by_id | → accounts_user | indexed; nullable |
| reason | CharField |  |
| method | CharField |  |
| reference | CharField |  |
| total | DecimalField(12,2) |  |
| points_reversed | DecimalField(10,2) |  |
| idempotency_key | UUIDField | unique; nullable |
| settlement_id | → sales_settlement | indexed; nullable |

## sales_returnline  (ReturnLine)

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| ret_id | → sales_salereturn | indexed |
| sale_line_id | → sales_saleline | indexed |
| qty | DecimalField(12,3) |  |
| amount | DecimalField(12,2) |  |
| discount | DecimalField(12,2) | Share of the original discount reversed |
| taxable | DecimalField(12,2) |  |
| cgst | DecimalField(12,2) |  |
| sgst | DecimalField(12,2) |  |
| cost | DecimalField(12,2) |  |
| disposition | CharField |  |

## expenses_expensecategory  (ExpenseCategory)

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| name | CharField | unique |

## expenses_expense  (Expense)

| Column | Type | Notes |
|---|---|---|
| id | BigAutoField | primary key |
| spent_on | DateField | indexed |
| category_id | → expenses_expensecategory | indexed |
| description | CharField |  |
| amount | DecimalField(12,2) |  |
| method | CharField |  |
| reference | CharField |  |
| shift_id | → sales_shift | indexed; nullable |
| created_by_id | → accounts_user | indexed |
| created_at | DateTimeField |  |
