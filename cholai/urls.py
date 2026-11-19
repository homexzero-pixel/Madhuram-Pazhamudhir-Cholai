from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

from . import views

urlpatterns = [
    path("", views.dashboard, name="dashboard"),
    path("admin/", admin.site.urls),
    path("accounts/", include("accounts.urls")),
    path("store/", include("store.urls")),
    path("inventory/", include("inventory.urls")),
    path("sales/", include("sales.urls")),
    path("expenses/", include("expenses.urls")),
    path("reports/", include("reports.urls")),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
