from django.urls import path

from . import views

urlpatterns = [
    path("", views.expense_list, name="expense_list"),
    path("add/", views.expense_edit, name="expense_create"),
    path("<int:pk>/edit/", views.expense_edit, name="expense_edit"),
    path("<int:pk>/delete/", views.expense_delete, name="expense_delete"),
    path("categories/", views.category_list, name="expense_category_list"),
    path("categories/add/", views.category_edit, name="expense_category_create"),
    path("categories/<int:pk>/edit/", views.category_edit, name="expense_category_edit"),
    path("categories/<int:pk>/delete/", views.category_delete, name="expense_category_delete"),
]
