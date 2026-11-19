from django.contrib import messages
from django.shortcuts import redirect, render

from accounts.permissions import admin_required

from .forms import StoreProfileForm
from .models import StoreProfile


@admin_required
def settings_view(request):
    form = StoreProfileForm(request.POST or None, request.FILES or None, instance=StoreProfile.load())
    if form.is_valid():
        form.save()
        messages.success(request, "Store settings saved.")
        return redirect("store_settings")
    return render(request, "form.html", {"form": form, "title": "Store settings", "back": "dashboard", "multipart": True})
