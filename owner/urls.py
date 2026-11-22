from django.urls import path

from . import views

urlpatterns = [
    path("", views.home, name="owner_home"),
    path("prices/", views.todays_prices, name="todays_prices"),
    path("prices/board/", views.price_board, name="price_board"),
    path("buy-list/", views.buy_list, name="buy_list"),
    path("loss-watch/", views.loss_watch, name="loss_watch"),
    path("day-summary/", views.day_summary, name="day_summary"),
    path("credit-reminders/", views.credit_reminders, name="credit_reminders"),
]
