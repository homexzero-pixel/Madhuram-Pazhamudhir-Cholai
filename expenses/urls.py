from django.urls import path

from . import views

urlpatterns = [
    path("", views.expense_list, name="expense_list"),
    path("new/", views.expense_edit, name="expense_add"),
    path("<int:pk>/", views.expense_edit, name="expense_edit"),
    path("categories/add/", views.category_add, name="expense_category_add"),
]
