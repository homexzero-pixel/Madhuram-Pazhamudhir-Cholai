from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path
from django.views.static import serve

urlpatterns = [
    path("django-admin/", admin.site.urls),
    path("", include("core.urls")),
    path("accounts/", include("accounts.urls")),
    path("products/", include("catalog.urls")),
    path("inventory/", include("inventory.urls")),
    path("purchases/", include("purchasing.urls")),
    path("customers/", include("customers.urls")),
    path("", include("sales.urls")),
    path("expenses/", include("expenses.urls")),
    path("reports/", include("reports.urls")),
    path("owner/", include("owner.urls")),
    # Static files are served by the app itself: it runs on one shop PC without a separate web server.
    re_path(r"^static/(?P<path>.*)$", serve, {"document_root": settings.STATIC_ROOT}),
]
