from datetime import timedelta

from django.contrib.auth.decorators import login_required
from django.shortcuts import render
from django.utils import timezone

from accounts.permissions import MANAGERS
from reports import analytics
from sales.models import Sale


@login_required
def dashboard(request):
    today = timezone.localdate()
    week = analytics.daily_sales(today - timedelta(days=6), today)
    context = {
        "today": analytics.summary(today, today),
        "month": analytics.summary(today.replace(day=1), today),
        "low_stock": analytics.low_stock(limit=8),
        "recent": Sale.objects.select_related("cashier")[:8]
        if request.user.has_role(*MANAGERS)
        else Sale.objects.filter(cashier=request.user)[:8],
        "week_chart": {
            "labels": [d["day"].strftime("%a") for d in week],
            "values": [float(d["total"]) for d in week],
        },
        "is_manager": request.user.has_role(*MANAGERS),
    }
    return render(request, "dashboard.html", context)
