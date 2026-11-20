from django.contrib import admin

from .models import Barcode, BaseProduct, Category, Department, Item


class BarcodeInline(admin.TabularInline):
    model = Barcode
    extra = 0


@admin.register(Item)
class ItemAdmin(admin.ModelAdmin):
    list_display = ("sku", "name", "category", "price", "on_hand", "is_active", "status")
    search_fields = ("sku", "name", "name_ta", "plu", "barcodes__code")
    list_filter = ("is_active", "status", "department")
    inlines = [BarcodeInline]


admin.site.register([Department, Category, BaseProduct])
