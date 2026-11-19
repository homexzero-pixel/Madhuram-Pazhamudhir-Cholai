from django.contrib import admin

from .models import CreditEntry, Customer, LoyaltyEntry, Offer

admin.site.register([Customer, LoyaltyEntry, CreditEntry, Offer])
