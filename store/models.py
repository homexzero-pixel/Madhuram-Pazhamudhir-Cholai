from django.db import models


class StoreProfile(models.Model):
    """Single-row table holding the shop details printed on bills and reports."""

    name = models.CharField(max_length=100, default="Madhuram Pazhamudhir Cholai")
    tagline = models.CharField(max_length=150, blank=True, default="Fresh fruits & vegetables every day")
    address = models.TextField(blank=True)
    phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    gstin = models.CharField("GSTIN", max_length=15, blank=True)
    logo = models.FileField(upload_to="logo/", blank=True, help_text="Leave empty to use the built-in Madhuram logo.")
    currency_symbol = models.CharField(max_length=5, default="₹")
    bill_footer = models.CharField(max_length=200, blank=True, default="Thank you! Visit again.")
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj
