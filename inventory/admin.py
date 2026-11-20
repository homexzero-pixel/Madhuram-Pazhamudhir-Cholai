from django.contrib import admin

from .models import StockCount, StockLot, StockMove

admin.site.register([StockLot, StockMove, StockCount])
