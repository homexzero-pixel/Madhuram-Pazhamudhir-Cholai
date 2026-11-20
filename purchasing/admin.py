from django.contrib import admin

from .models import GoodsReceipt, PurchaseOrder, PurchaseReturn, Supplier, SupplierPayment

admin.site.register([Supplier, PurchaseOrder, GoodsReceipt, PurchaseReturn, SupplierPayment])
